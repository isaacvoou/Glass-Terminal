#ifndef GT_PTY_H
#define GT_PTY_H
#include <stddef.h>
#include <sys/types.h>

typedef struct gt_pty gt_pty;

/* The owner calls these from one UI thread; internal I/O runs on a worker.
 * Buffers are bounded. All data is bytes; UTF-8 decoding belongs to the renderer.
 * On failure open sets errno. argv must include argv[0] and a terminating NULL. */
gt_pty *gt_pty_open(const char *shell, char *const argv[], const char *directory,
                    unsigned columns, unsigned rows);
int gt_pty_write(gt_pty *, const void *bytes, size_t length);
size_t gt_pty_read(gt_pty *, void *bytes, size_t capacity);
int gt_pty_resize(gt_pty *, unsigned columns, unsigned rows);
int gt_pty_exited(gt_pty *, int *wait_status);
int gt_pty_has_foreground_job(gt_pty *);
pid_t gt_pty_pid(gt_pty *);
/* Stop the worker, hang up this PTY's process groups, reap the child, free. */
void gt_pty_close(gt_pty *);
#endif
