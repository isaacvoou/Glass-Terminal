#define _GNU_SOURCE 1
#include "pty.h"
#include <errno.h>
#include <fcntl.h>
#include <limits.h>
#include <poll.h>
#include <pthread.h>
#include <signal.h>
#include <spawn.h>
#include <stdint.h>
#include <stdlib.h>
#include <string.h>
#include <sys/ioctl.h>
#include <sys/wait.h>
#include <time.h>
#include <unistd.h>
#ifdef __APPLE__
#include <util.h>
#else
#include <pty.h>
#endif

extern char **environ;
enum { OUTPUT_CAP = 1024 * 1024, INPUT_CAP = 4 * 1024 * 1024 };
typedef struct { unsigned char *data; size_t cap, head, count; } ring;
struct gt_pty {
    int master, wake[2], stopping, exited, status;
    pid_t pid;
    pthread_t worker;
    pthread_mutex_t lock;
    ring input, output;
};

static size_t ring_get(ring *q, void *dst, size_t length) {
    if (length > q->count) length = q->count;
    size_t first = q->cap - q->head;
    if (first > length) first = length;
    memcpy(dst, q->data + q->head, first);
    memcpy((unsigned char *)dst + first, q->data, length - first);
    q->head = (q->head + length) % q->cap;
    q->count -= length;
    return length;
}
static void ring_put(ring *q, const void *src, size_t length) {
    size_t tail = (q->head + q->count) % q->cap;
    size_t first = q->cap - tail;
    if (first > length) first = length;
    memcpy(q->data + tail, src, first);
    memcpy(q->data, (const unsigned char *)src + first, length - first);
    q->count += length;
}
static int fd_flags(int fd) {
    int flags = fcntl(fd, F_GETFL);
    return flags < 0 || fcntl(fd, F_SETFL, flags | O_NONBLOCK) < 0 ||
           fcntl(fd, F_SETFD, FD_CLOEXEC) < 0 ? -1 : 0;
}
static void wake_worker(gt_pty *p) {
    unsigned char byte = 1;
    ssize_t result;
    do { result = write(p->wake[1], &byte, 1); } while (result < 0 && errno == EINTR);
}
static int replacement_key(const char *s) {
    static const char *keys[] = { "TERM=", "COLORTERM=", "TERM_PROGRAM=",
        "TERM_PROGRAM_VERSION=", "SHELL=" };
    for (size_t i = 0; i < sizeof keys / sizeof *keys; i++)
        if (!strncmp(s, keys[i], strlen(keys[i]))) return 1;
    return 0;
}
static char **make_environment(const char *shell) {
    size_t count = 0;
    while (environ[count]) count++;
    char **env = calloc(count + 8, sizeof *env);
    if (!env) return NULL;
    size_t used = 0;
    for (size_t i = 0; i < count; i++)
        if (!replacement_key(environ[i])) env[used++] = environ[i];
    env[used++] = "TERM=xterm-256color";
    env[used++] = "COLORTERM=truecolor";
    env[used++] = "TERM_PROGRAM=GlassTerminal";
    env[used++] = "TERM_PROGRAM_VERSION=0.1.0";
    size_t n = strlen(shell) + sizeof "SHELL=";
    char *shell_var = malloc(n);
    if (!shell_var) { free(env); return NULL; }
    memcpy(shell_var, "SHELL=", 6);
    memcpy(shell_var + 6, shell, strlen(shell) + 1);
    env[used++] = shell_var;
    if (!getenv("LANG") && !getenv("LC_ALL") && !getenv("LC_CTYPE"))
        env[used++] = "LC_CTYPE=en_US.UTF-8";
    return env;
}
static void free_environment(char **env) {
    if (!env) return;
    for (size_t i = 0; env[i]; i++)
        if (!strncmp(env[i], "SHELL=", 6)) free(env[i]);
    free(env);
}
static void hang_up_and_reap(gt_pty *p) {
    /* Only signal groups obtained from our own, still open controlling PTY.
     * Do not signal a pid after waitpid has reaped it. */
    pid_t foreground = tcgetpgrp(p->master);
    if (foreground > 0 && foreground != getpgrp()) kill(-foreground, SIGHUP);
    int status = 0;
    pid_t result = waitpid(p->pid, &status, WNOHANG);
    if (result == 0) {
        kill(-p->pid, SIGHUP);
        kill(p->pid, SIGHUP);
        for (int i = 0; i < 50; i++) {
            struct timespec pause = {0, 10000000};
            nanosleep(&pause, NULL);
            result = waitpid(p->pid, &status, WNOHANG);
            if (result != 0) break;
        }
        if (result == 0) {
            kill(p->pid, SIGKILL);
            do { result = waitpid(p->pid, &status, 0); } while (result < 0 && errno == EINTR);
        }
    }
    pthread_mutex_lock(&p->lock);
    close(p->master);
    p->master = -1;
    p->status = result == p->pid ? status : 0;
    p->exited = 1;
    pthread_mutex_unlock(&p->lock);
}
static void *io_worker(void *context) {
    gt_pty *p = context;
    unsigned char buffer[32768];
    for (;;) {
        pthread_mutex_lock(&p->lock);
        int stop = p->stopping;
        short events = 0;
        if (p->output.count < p->output.cap) events |= POLLIN;
        if (p->input.count) events |= POLLOUT;
        pthread_mutex_unlock(&p->lock);
        if (stop) break;
        struct pollfd fds[2] = {
            { events ? p->master : -1, events, 0 }, {p->wake[0], POLLIN, 0}
        };
        int n = poll(fds, 2, -1);
        if (n < 0) { if (errno == EINTR) continue; break; }
        if (fds[1].revents & POLLIN)
            while (read(p->wake[0], buffer, sizeof buffer) > 0) {}
        int eof = 0;
        pthread_mutex_lock(&p->lock);
        if (fds[0].revents & (POLLIN | POLLHUP | POLLERR)) {
            size_t cap = p->output.cap - p->output.count;
            if (cap > sizeof buffer) cap = sizeof buffer;
            if (cap) {
                ssize_t got = read(p->master, buffer, cap);
                if (got > 0) ring_put(&p->output, buffer, (size_t)got);
                else if (!got || (errno != EAGAIN && errno != EWOULDBLOCK && errno != EINTR)) eof = 1;
            }
        }
        if ((fds[0].revents & POLLOUT) && p->input.count) {
            size_t cap = p->input.cap - p->input.head;
            if (cap > p->input.count) cap = p->input.count;
            ssize_t sent = write(p->master, p->input.data + p->input.head, cap);
            if (sent > 0) {
                p->input.head = (p->input.head + (size_t)sent) % p->input.cap;
                p->input.count -= (size_t)sent;
            } else if (sent < 0 && errno != EAGAIN && errno != EWOULDBLOCK && errno != EINTR) eof = 1;
        }
        if (fds[0].revents & POLLNVAL) eof = 1;
        pthread_mutex_unlock(&p->lock);
        if (eof) break;
    }
    hang_up_and_reap(p);
    return NULL;
}

gt_pty *gt_pty_open(const char *shell, char *const argv[], const char *directory,
                    unsigned columns, unsigned rows) {
    if (!shell || shell[0] != '/' || !argv || !argv[0] ||
        !columns || !rows || columns > USHRT_MAX || rows > USHRT_MAX) {
        errno = EINVAL; return NULL;
    }
    gt_pty *p = calloc(1, sizeof *p);
    if (!p) return NULL;
    p->master = p->wake[0] = p->wake[1] = -1;
    p->input.cap = INPUT_CAP; p->output.cap = OUTPUT_CAP;
    p->input.data = malloc(INPUT_CAP); p->output.data = malloc(OUTPUT_CAP);
    if (!p->input.data || !p->output.data) goto fail;
    int error = pthread_mutex_init(&p->lock, NULL);
    if (error) { errno = error; goto fail; }
    int slave = -1;
    char slave_name[PATH_MAX];
    struct winsize size = { .ws_row = (unsigned short)rows, .ws_col = (unsigned short)columns };
    if (openpty(&p->master, &slave, slave_name, NULL, &size) < 0) goto mutex_fail;
    close(slave);
    if (fd_flags(p->master) < 0 || pipe(p->wake) < 0 ||
        fd_flags(p->wake[0]) < 0 || fd_flags(p->wake[1]) < 0) goto mutex_fail;
    char **env = make_environment(shell);
    if (!env) goto mutex_fail;
    posix_spawn_file_actions_t actions;
    posix_spawnattr_t attributes;
    if ((error = posix_spawn_file_actions_init(&actions))) { free_environment(env); errno = error; goto mutex_fail; }
    if ((error = posix_spawnattr_init(&attributes))) {
        posix_spawn_file_actions_destroy(&actions); free_environment(env); errno = error; goto mutex_fail;
    }
    sigset_t empty, defaults;
    sigemptyset(&empty); sigfillset(&defaults);
    short flags = POSIX_SPAWN_SETSID | POSIX_SPAWN_SETSIGMASK | POSIX_SPAWN_SETSIGDEF;
#ifdef __APPLE__
    flags |= POSIX_SPAWN_CLOEXEC_DEFAULT;
#endif
#define SPAWN_STEP(call) do { if (!error) error = (call); } while (0)
    SPAWN_STEP(posix_spawnattr_setflags(&attributes, flags));
    SPAWN_STEP(posix_spawnattr_setsigmask(&attributes, &empty));
    SPAWN_STEP(posix_spawnattr_setsigdefault(&attributes, &defaults));
    /* SETSID runs before opening the slave: open acquires the controlling tty.
     * No fork-after-AppKit and no allocator/Objective-C calls in a fork child. */
    SPAWN_STEP(posix_spawn_file_actions_addopen(&actions, STDIN_FILENO, slave_name, O_RDWR, 0));
    SPAWN_STEP(posix_spawn_file_actions_adddup2(&actions, STDIN_FILENO, STDOUT_FILENO));
    SPAWN_STEP(posix_spawn_file_actions_adddup2(&actions, STDIN_FILENO, STDERR_FILENO));
    SPAWN_STEP(posix_spawn_file_actions_addclose(&actions, p->master));
    SPAWN_STEP(posix_spawn_file_actions_addclose(&actions, p->wake[0]));
    SPAWN_STEP(posix_spawn_file_actions_addclose(&actions, p->wake[1]));
    if (directory) SPAWN_STEP(posix_spawn_file_actions_addchdir_np(&actions, directory));
    if (!error) error = posix_spawn(&p->pid, shell, &actions, &attributes, argv, env);
#undef SPAWN_STEP
    posix_spawnattr_destroy(&attributes);
    posix_spawn_file_actions_destroy(&actions);
    free_environment(env);
    if (error) { errno = error; goto mutex_fail; }
    error = pthread_create(&p->worker, NULL, io_worker, p);
    if (error) {
        kill(p->pid, SIGKILL);
        while (waitpid(p->pid, NULL, 0) < 0 && errno == EINTR) {}
        errno = error; goto mutex_fail;
    }
    return p;
mutex_fail: {
    int saved = errno;
    pthread_mutex_destroy(&p->lock); errno = saved;
}
fail: {
    int saved = errno;
    if (p->master >= 0) close(p->master);
    if (p->wake[0] >= 0) close(p->wake[0]);
    if (p->wake[1] >= 0) close(p->wake[1]);
    free(p->input.data); free(p->output.data); free(p);
    errno = saved; return NULL;
}}
int gt_pty_write(gt_pty *p, const void *bytes, size_t length) {
    if (!p || (!bytes && length)) { errno = EINVAL; return -1; }
    pthread_mutex_lock(&p->lock);
    int error = p->exited || p->stopping ? EPIPE :
        (length > p->input.cap - p->input.count ? ENOBUFS : 0);
    if (!error && length) ring_put(&p->input, bytes, length);
    pthread_mutex_unlock(&p->lock);
    if (error) { errno = error; return -1; }
    wake_worker(p); return 0;
}
size_t gt_pty_read(gt_pty *p, void *bytes, size_t cap) {
    if (!p || !bytes || !cap) return 0;
    pthread_mutex_lock(&p->lock);
    size_t got = ring_get(&p->output, bytes, cap);
    pthread_mutex_unlock(&p->lock);
    if (got) wake_worker(p);
    return got;
}
int gt_pty_resize(gt_pty *p, unsigned columns, unsigned rows) {
    if (!p || !columns || !rows || columns > USHRT_MAX || rows > USHRT_MAX) { errno = EINVAL; return -1; }
    struct winsize size = { .ws_row = (unsigned short)rows, .ws_col = (unsigned short)columns };
    pthread_mutex_lock(&p->lock);
    int result = p->master < 0 ? (errno = EPIPE, -1) : ioctl(p->master, TIOCSWINSZ, &size);
    int saved = errno;
    pthread_mutex_unlock(&p->lock); errno = saved;
    return result;
}
int gt_pty_exited(gt_pty *p, int *status) {
    pthread_mutex_lock(&p->lock);
    int exited = p->exited;
    if (exited && status) *status = p->status;
    pthread_mutex_unlock(&p->lock); return exited;
}
int gt_pty_has_foreground_job(gt_pty *p) {
    pthread_mutex_lock(&p->lock);
    pid_t group = p->master < 0 ? -1 : tcgetpgrp(p->master);
    int running = !p->exited && group > 0 && group != p->pid;
    pthread_mutex_unlock(&p->lock); return running;
}
pid_t gt_pty_pid(gt_pty *p) { return p->pid; }
void gt_pty_close(gt_pty *p) {
    if (!p) return;
    pthread_mutex_lock(&p->lock); p->stopping = 1; pthread_mutex_unlock(&p->lock);
    wake_worker(p); pthread_join(p->worker, NULL);
    close(p->wake[0]); close(p->wake[1]); pthread_mutex_destroy(&p->lock);
    free(p->input.data); free(p->output.data); free(p);
}
