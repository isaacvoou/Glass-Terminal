#import <Cocoa/Cocoa.h>
#import <WebKit/WebKit.h>
#import <QuartzCore/QuartzCore.h>
#include <errno.h>
#include <math.h>
#include <pwd.h>
#include <signal.h>
#include <string.h>
#include <sys/wait.h>
#include <unistd.h>
#include "pty.h"

@class GTAppDelegate, GTWindowController;
static NSString * const GTOpacity = @"backgroundOpacity";
static NSString * const GTRadius = @"cornerRadius";
static NSString * const GTFontSize = @"fontSize";
static NSString * const GTBlur = @"blurBackground";

static NSString *JSArguments(NSArray *args) {
    NSData *data = [NSJSONSerialization dataWithJSONObject:args options:0 error:NULL];
    return data ? [[NSString alloc] initWithData:data encoding:NSUTF8StringEncoding] : @"[]";
}
static void ShowError(NSWindow *window, NSString *message) {
    NSAlert *alert = [[NSAlert alloc] init];
    alert.messageText = @"Glass Terminal";
    alert.informativeText = message;
    [alert addButtonWithTitle:@"Понятно"];
    if (window) [alert beginSheetModalForWindow:window completionHandler:nil];
    else [alert runModal];
}

@interface GTWindow : NSWindow
@end
@implementation GTWindow
- (BOOL)canBecomeKeyWindow { return YES; }
- (BOOL)canBecomeMainWindow { return YES; }
@end

@interface GTTitleBar : NSView
@end
@implementation GTTitleBar
- (void)mouseDown:(NSEvent *)event {
    if (event.clickCount == 2) [self.window zoom:nil];
    else [self.window performWindowDragWithEvent:event];
}
@end

@interface GTWebView : WKWebView
@property(nonatomic, weak) GTWindowController *owner;
@end

@interface GTSession : NSObject <WKScriptMessageHandler, WKNavigationDelegate>
@property(nonatomic, weak) GTWindowController *owner;
@property(nonatomic, strong) GTWebView *web;
@property(nonatomic, copy) NSString *title;
@property(nonatomic, strong) NSURL *pageURL;
@property(nonatomic, assign) gt_pty *pty;
@property(nonatomic) BOOL ready;
@property(nonatomic) BOOL inFlight;
@property(nonatomic) BOOL exitReported;
@property(nonatomic) BOOL stopped;
- (instancetype)initWithOwner:(GTWindowController *)owner;
- (void)pump;
- (void)stop;
- (void)invoke:(NSString *)function args:(NSArray *)args;
- (BOOL)hasForegroundJob;
- (BOOL)isRunning;
@end

@interface GTContentView : NSView
@property(nonatomic, weak) GTWindowController *owner;
@end

@interface GTWindowController : NSWindowController <NSWindowDelegate>
@property(nonatomic, weak) GTAppDelegate *app;
@property(nonatomic, strong) NSMutableArray<GTSession *> *sessions;
@property(nonatomic, strong) GTContentView *root;
@property(nonatomic, strong) NSVisualEffectView *effect;
@property(nonatomic, strong) NSView *tint;
@property(nonatomic, strong) NSView *host;
@property(nonatomic, strong) GTTitleBar *header;
@property(nonatomic, strong) NSScrollView *tabScroll;
@property(nonatomic, strong) NSSegmentedControl *tabs;
@property(nonatomic, strong) NSButton *plus;
@property(nonatomic, strong) NSButton *settings;
@property(nonatomic) NSInteger selected;
@property(nonatomic) BOOL closing;
- (instancetype)initWithApp:(GTAppDelegate *)app;
- (GTSession *)currentSession;
- (void)newTab:(id)sender;
- (void)closeTab:(id)sender;
- (void)selectTab:(id)sender;
- (void)selectIndex:(NSInteger)index;
- (void)refreshTabs;
- (void)layoutContent;
- (void)applyAppearance;
- (void)shutdown;
- (void)pasteText:(NSString *)text;
- (void)copy:(id)sender;
- (void)paste:(id)sender;
- (void)find:(id)sender;
- (void)closeWindow:(id)sender;
- (void)minimizeWindow:(id)sender;
- (void)fullScreen:(id)sender;
- (void)selectAll:(id)sender;
- (void)clear:(id)sender;
- (void)terminalCopy:(id)sender;
- (void)terminalPaste:(id)sender;
- (void)terminalFind:(id)sender;
- (void)terminalSelectAll:(id)sender;
- (void)clearScrollback:(id)sender;
- (void)nextTab:(id)sender;
- (void)previousTab:(id)sender;
- (void)tabByNumber:(NSMenuItem *)sender;
- (void)gt_adjustFontBy:(NSInteger)delta;
- (void)largerFont:(id)sender;
- (void)smallerFont:(id)sender;
- (void)resetFont:(id)sender;
@end

@interface GTAppDelegate : NSObject <NSApplicationDelegate>
@property(nonatomic, strong) NSMutableArray<GTWindowController *> *windows;
@property(nonatomic, strong) NSTimer *timer;
@property(nonatomic, strong) NSPanel *settingsPanel;
@property(nonatomic, strong) NSMutableArray<NSTextField *> *settingValues;
- (void)newWindow:(id)sender;
- (void)showSettings:(id)sender;
- (void)settingChanged:(NSControl *)sender;
- (void)applyAppearance;
@end

@implementation GTWebView
- (BOOL)isOpaque { return NO; }
- (NSMenu *)menuForEvent:(NSEvent *)event {
    (void)event;
    NSMenu *menu = [[NSMenu alloc] initWithTitle:@""];
    for (NSArray *item in @[@[@"Копировать", @"copy:"], @[@"Вставить", @"paste:"], @[@"Найти…", @"find:"]]) {
        NSMenuItem *entry = [menu addItemWithTitle:item[0] action:NSSelectorFromString(item[1]) keyEquivalent:@""];
        entry.target = self.owner;
    }
    return menu;
}
- (NSDragOperation)draggingEntered:(id<NSDraggingInfo>)sender {
    return [sender.draggingPasteboard canReadObjectForClasses:@[[NSURL class]]
        options:@{NSPasteboardURLReadingFileURLsOnlyKey:@YES}] ? NSDragOperationCopy : NSDragOperationNone;
}
- (NSDragOperation)draggingUpdated:(id<NSDraggingInfo>)sender { return [self draggingEntered:sender]; }
- (BOOL)prepareForDragOperation:(id<NSDraggingInfo>)sender { return [self draggingEntered:sender] != NSDragOperationNone; }
- (BOOL)performDragOperation:(id<NSDraggingInfo>)sender {
    NSArray<NSURL *> *files = [sender.draggingPasteboard readObjectsForClasses:@[[NSURL class]]
        options:@{NSPasteboardURLReadingFileURLsOnlyKey:@YES}];
    if (!files.count) return NO;
    NSMutableArray *paths = [NSMutableArray array];
    for (NSURL *url in files) {
        NSString *escaped = [url.path stringByReplacingOccurrencesOfString:@"'" withString:@"'\\''"];
        [paths addObject:[NSString stringWithFormat:@"'%@'", escaped]];
    }
    [self.owner pasteText:[[paths componentsJoinedByString:@" "] stringByAppendingString:@" "]];
    return YES;
}
@end

@implementation GTSession
- (instancetype)initWithOwner:(GTWindowController *)owner {
    if (!(self = [super init])) return nil;
    _owner = owner;
    _title = @"Оболочка";
    NSURL *resources = NSBundle.mainBundle.resourceURL;
    _pageURL = [resources URLByAppendingPathComponent:@"index.html"];
    WKWebViewConfiguration *config = [[WKWebViewConfiguration alloc] init];
    config.websiteDataStore = WKWebsiteDataStore.nonPersistentDataStore;
    [config.userContentController addScriptMessageHandler:self name:@"terminal"];
    _web = [[GTWebView alloc] initWithFrame:NSMakeRect(0, 0, 800, 500) configuration:config];
    _web.owner = owner;
    _web.navigationDelegate = self;
    _web.autoresizingMask = NSViewWidthSizable | NSViewHeightSizable;
    _web.underPageBackgroundColor = NSColor.clearColor;
    _web.wantsLayer = YES;
    _web.layer.backgroundColor = NSColor.clearColor.CGColor;
    _web.allowsBackForwardNavigationGestures = NO;
    [_web registerForDraggedTypes:@[NSPasteboardTypeFileURL]];
    /* WebKit has no public switch for the page's drawing background on macOS.
     * This optional, isolated compatibility hook is NOT a system modification.
     * All window geometry and visual effects use public AppKit APIs. */
    @try { [_web setValue:@NO forKey:@"drawsBackground"]; }
    @catch (NSException *exception) {
        NSLog(@"WebKit background compatibility hook unavailable: %@", exception.name);
    }
    [_web loadFileURL:_pageURL allowingReadAccessToURL:resources];
    return self;
}
- (void)invoke:(NSString *)function args:(NSArray *)args {
    if (self.stopped || !self.ready) return;
    NSString *script = [NSString stringWithFormat:@"window.Glass && window.Glass.%@.apply(null,%@)",
                        function, JSArguments(args)];
    __weak GTSession *weak = self;
    [self.web evaluateJavaScript:script completionHandler:^(id value, NSError *error) {
        (void)value;
        GTSession *session = weak;
        if (!session || session.stopped || !error) return;
        [session stop];
        ShowError(session.owner.window, @"Не удалось передать данные интерфейсу терминала. Сеанс закрыт. Откройте новую вкладку.");
    }];
}
- (void)startWithColumns:(unsigned)cols rows:(unsigned)rows {
    struct passwd *user = getpwuid(getuid());
    NSString *shell = user && user->pw_shell && user->pw_shell[0] ?
        [NSString stringWithUTF8String:user->pw_shell] : @"/bin/zsh";
    char *arguments[] = {(char *)shell.fileSystemRepresentation, "-l", NULL};
    self.pty = gt_pty_open(shell.fileSystemRepresentation, arguments,
                          NSHomeDirectory().fileSystemRepresentation, cols, rows);
    if (!self.pty) {
        int error = errno;
        [self invoke:@"toast" args:@[[NSString stringWithFormat:@"Не удалось запустить оболочку: %s", strerror(error)]]];
        return;
    }
    self.title = shell.lastPathComponent;
    [self.owner refreshTabs];
}
- (void)userContentController:(WKUserContentController *)controller didReceiveScriptMessage:(WKScriptMessage *)message {
    (void)controller;
    if (self.stopped || !message.frameInfo.isMainFrame ||
        ![message.frameInfo.request.URL.path isEqualToString:self.pageURL.path] ||
        ![message.body isKindOfClass:NSDictionary.class]) return;
    NSDictionary *body = message.body;
    NSString *type = body[@"type"];
    if (![type isKindOfClass:NSString.class]) return;
    if ([type isEqualToString:@"ready"] || [type isEqualToString:@"resize"]) {
        if (![body[@"cols"] isKindOfClass:NSNumber.class] || ![body[@"rows"] isKindOfClass:NSNumber.class]) return;
        NSInteger cols = [body[@"cols"] integerValue], rows = [body[@"rows"] integerValue];
        if (cols < 2 || rows < 1 || cols > 2000 || rows > 1000) return;
        if ([type isEqualToString:@"ready"] && !self.ready) {
            self.ready = YES;
            [self invoke:@"configure" args:@[@([NSUserDefaults.standardUserDefaults doubleForKey:GTFontSize])]];
            [self startWithColumns:(unsigned)cols rows:(unsigned)rows];
        } else if (self.pty) gt_pty_resize(self.pty, (unsigned)cols, (unsigned)rows);
    } else if ([type isEqualToString:@"ack"]) {
        self.inFlight = NO;
        [self pump];
    } else if ([type isEqualToString:@"input"] && self.pty) {
        NSString *base64 = body[@"data"];
        if (![base64 isKindOfClass:NSString.class] || base64.length > 6 * 1024 * 1024) return;
        NSData *data = [[NSData alloc] initWithBase64EncodedString:base64 options:0];
        if (data && gt_pty_write(self.pty, data.bytes, data.length) < 0 && errno != EPIPE)
            [self invoke:@"toast" args:@[@"Ввод не помещается в буфер. Вставляйте текст меньшими частями."]];
    } else if ([type isEqualToString:@"title"]) {
        NSString *title = body[@"title"];
        if (![title isKindOfClass:NSString.class]) return;
        title = [[title componentsSeparatedByCharactersInSet:NSCharacterSet.controlCharacterSet] componentsJoinedByString:@" "];
        if (title.length > 100) title = [title substringToIndex:100];
        if (title.length) { self.title = title; [self.owner refreshTabs]; }
    } else if ([type isEqualToString:@"copy"]) {
        NSString *text = body[@"text"];
        if (![text isKindOfClass:NSString.class] || text.length > 4 * 1024 * 1024 || !text.length) return;
        [NSPasteboard.generalPasteboard clearContents];
        [NSPasteboard.generalPasteboard setString:text forType:NSPasteboardTypeString];
    } else if ([type isEqualToString:@"bell"]) NSBeep();
    else if ([type isEqualToString:@"openLink"]) {
        NSString *text = body[@"url"];
        if (![text isKindOfClass:NSString.class] || text.length > 8192) return;
        NSURL *url = [NSURL URLWithString:text];
        if ([url.scheme.lowercaseString isEqualToString:@"https"] || [url.scheme.lowercaseString isEqualToString:@"http"])
            [NSWorkspace.sharedWorkspace openURL:url];
    }
}
- (void)pump {
    if (!self.ready || self.inFlight || !self.pty || self.stopped) return;
    unsigned char bytes[65536];
    size_t length = gt_pty_read(self.pty, bytes, sizeof bytes);
    if (length) {
        self.inFlight = YES;
        NSString *base64 = [[NSData dataWithBytes:bytes length:length] base64EncodedStringWithOptions:0];
        [self invoke:@"write" args:@[base64]];
    } else if (!self.exitReported) {
        int status;
        if (gt_pty_exited(self.pty, &status)) {
            self.exitReported = YES;
            int code = WIFEXITED(status) ? WEXITSTATUS(status) : (WIFSIGNALED(status) ? 128 + WTERMSIG(status) : -1);
            [self invoke:@"exited" args:@[@(code)]];
            self.title = [self.title stringByAppendingString:@" · завершён"];
            [self.owner refreshTabs];
        }
    }
}
- (BOOL)hasForegroundJob { return self.pty && gt_pty_has_foreground_job(self.pty); }
- (BOOL)isRunning { return self.pty && !gt_pty_exited(self.pty, NULL); }
- (void)webView:(WKWebView *)webView decidePolicyForNavigationAction:(WKNavigationAction *)action
    decisionHandler:(void (^)(WKNavigationActionPolicy))decisionHandler {
    (void)webView;
    BOOL allowed = action.request.URL.isFileURL &&
        [action.request.URL.path isEqualToString:self.pageURL.path] &&
        action.targetFrame.isMainFrame && action.navigationType == WKNavigationTypeOther;
    decisionHandler(allowed ? WKNavigationActionPolicyAllow : WKNavigationActionPolicyCancel);
}
- (void)webView:(WKWebView *)webView didFailProvisionalNavigation:(WKNavigation *)navigation withError:(NSError *)error {
    (void)webView; (void)navigation;
    if (error.code != NSURLErrorCancelled) ShowError(self.owner.window, error.localizedDescription);
}
- (void)webViewWebContentProcessDidTerminate:(WKWebView *)webView {
    (void)webView;
    [self stop];
    ShowError(self.owner.window, @"WebKit завершил процесс интерфейса. Сеанс закрыт; можно открыть новую вкладку.");
}
- (void)stop {
    if (self.stopped) return;
    self.stopped = YES;
    [self.web.configuration.userContentController removeScriptMessageHandlerForName:@"terminal"];
    self.web.navigationDelegate = nil;
    [self.web stopLoading];
    if (self.pty) { gt_pty_close(self.pty); self.pty = NULL; }
}
- (void)dealloc { if (_pty) gt_pty_close(_pty); }
@end

@implementation GTContentView
- (BOOL)isOpaque { return NO; }
- (void)layout { [super layout]; [self.owner layoutContent]; }
@end

@implementation GTWindowController
- (instancetype)initWithApp:(GTAppDelegate *)app {
    GTWindow *window = [[GTWindow alloc] initWithContentRect:NSMakeRect(0, 0, 1000, 650)
        styleMask:NSWindowStyleMaskBorderless | NSWindowStyleMaskResizable | NSWindowStyleMaskMiniaturizable
        backing:NSBackingStoreBuffered defer:NO];
    if (!(self = [super initWithWindow:window])) return nil;
    _app = app; _sessions = [NSMutableArray array]; _selected = -1;
    window.title = @"Glass Terminal";
    window.opaque = NO; window.backgroundColor = NSColor.clearColor;
    window.hasShadow = YES; window.releasedWhenClosed = NO;
    window.minSize = NSMakeSize(520, 320);
    window.collectionBehavior = NSWindowCollectionBehaviorFullScreenPrimary;
    window.delegate = self;
    _root = [[GTContentView alloc] initWithFrame:NSMakeRect(0, 0, 1000, 650)];
    _root.owner = self; _root.wantsLayer = YES;
    _root.layer.masksToBounds = YES;
    _root.layer.cornerCurve = kCACornerCurveContinuous;
    _root.layer.borderWidth = 1;
    _root.layer.borderColor = [NSColor colorWithWhite:1 alpha:0.15].CGColor;
    window.contentView = _root;
    window.appearance = [NSAppearance appearanceNamed:NSAppearanceNameDarkAqua];
    _effect = [[NSVisualEffectView alloc] initWithFrame:_root.bounds];
    _effect.blendingMode = NSVisualEffectBlendingModeBehindWindow;
    _effect.material = NSVisualEffectMaterialHUDWindow;
    _effect.state = NSVisualEffectStateFollowsWindowActiveState;
    [_root addSubview:_effect];
    _tint = [[NSView alloc] initWithFrame:_root.bounds]; _tint.wantsLayer = YES;
    [_root addSubview:_tint];
    _header = [[GTTitleBar alloc] initWithFrame:NSZeroRect];
    _header.wantsLayer = YES;
    _header.layer.backgroundColor = [NSColor colorWithWhite:1 alpha:0.025].CGColor;
    [_root addSubview:_header];
    _host = [[NSView alloc] initWithFrame:NSZeroRect]; [_root addSubview:_host];
    NSArray *colors = @[[NSColor colorWithRed:1 green:0.37 blue:0.36 alpha:1],
        [NSColor colorWithRed:1 green:0.75 blue:0.27 alpha:1],
        [NSColor colorWithRed:0.18 green:0.79 blue:0.34 alpha:1]];
    NSArray *actions = @[@"closeWindow:", @"minimizeWindow:", @"fullScreen:"];
    NSArray *labels = @[@"Закрыть окно", @"Свернуть окно", @"Полноэкранный режим"];
    for (NSInteger i = 0; i < 3; i++) {
        NSButton *button = [NSButton buttonWithTitle:@"" target:self action:NSSelectorFromString(actions[i])];
        button.bordered = NO; button.wantsLayer = YES;
        button.layer.backgroundColor = [colors[i] CGColor]; button.layer.cornerRadius = 6.5;
        button.frame = NSMakeRect(18 + 21 * i, 17, 13, 13);
        button.toolTip = labels[i]; button.accessibilityLabel = labels[i];
        button.focusRingType = NSFocusRingTypeNone; [_header addSubview:button];
    }
    _tabs = [[NSSegmentedControl alloc] initWithFrame:NSZeroRect];
    _tabs.segmentStyle = NSSegmentStyleTexturedRounded;
    _tabs.trackingMode = NSSegmentSwitchTrackingSelectOne;
    _tabs.target = self; _tabs.action = @selector(selectTab:);
    _tabScroll = [[NSScrollView alloc] initWithFrame:NSZeroRect];
    _tabScroll.drawsBackground = NO; _tabScroll.hasHorizontalScroller = NO;
    _tabScroll.documentView = _tabs; [_header addSubview:_tabScroll];
    _plus = [NSButton buttonWithImage:[NSImage imageWithSystemSymbolName:@"plus" accessibilityDescription:@"Новая вкладка"]
        target:self action:@selector(newTab:)];
    _plus.bordered = NO; _plus.toolTip = @"Новая вкладка (⌘T)"; [_header addSubview:_plus];
    _settings = [NSButton buttonWithImage:[NSImage imageWithSystemSymbolName:@"slider.horizontal.3" accessibilityDescription:@"Оформление"]
        target:app action:@selector(showSettings:)];
    _settings.bordered = NO; _settings.toolTip = @"Оформление (⌘,)"; [_header addSubview:_settings];
    [self applyAppearance]; [self layoutContent];
    [window center]; [window makeKeyAndOrderFront:nil];
    [self newTab:nil];
    return self;
}
- (GTSession *)currentSession {
    return self.selected >= 0 && self.selected < (NSInteger)self.sessions.count ? self.sessions[self.selected] : nil;
}
- (void)layoutContent {
    CGFloat width = self.root.bounds.size.width, height = self.root.bounds.size.height;
    self.effect.frame = self.root.bounds; self.tint.frame = self.root.bounds;
    self.header.frame = NSMakeRect(0, height - 48, width, 48);
    self.host.frame = NSMakeRect(15, 15, MAX(0, width - 30), MAX(0, height - 72));
    self.plus.frame = NSMakeRect(width - 80, 10, 28, 28);
    self.settings.frame = NSMakeRect(width - 45, 10, 28, 28);
    self.tabScroll.frame = NSMakeRect(95, 10, MAX(100, width - 185), 28);
    CGFloat tabWidth = 150;
    self.tabs.frame = NSMakeRect(0, 0, MAX(self.tabScroll.bounds.size.width, self.sessions.count * tabWidth), 28);
    for (NSInteger i = 0; i < (NSInteger)self.sessions.count; i++) [self.tabs setWidth:tabWidth forSegment:i];
    [self.window invalidateShadow];
}
- (void)applyAppearance {
    NSUserDefaults *prefs = NSUserDefaults.standardUserDefaults;
    double opacity = MAX(0, MIN(1, [prefs doubleForKey:GTOpacity]));
    double radius = MAX(8, MIN(40, [prefs doubleForKey:GTRadius]));
    BOOL fullscreen = (self.window.styleMask & NSWindowStyleMaskFullScreen) != 0;
    self.root.layer.cornerRadius = fullscreen ? 0 : radius;
    self.effect.hidden = ![prefs boolForKey:GTBlur] || opacity < 0.001;
    self.tint.layer.backgroundColor = [NSColor colorWithRed:0.045 green:0.06 blue:0.09 alpha:opacity].CGColor;
    for (GTSession *session in self.sessions)
        [session invoke:@"configure" args:@[@([prefs doubleForKey:GTFontSize])]];
    [self.window invalidateShadow];
}
- (void)newTab:(id)sender {
    (void)sender;
    GTSession *session = [[GTSession alloc] initWithOwner:self];
    session.web.frame = self.host.bounds; session.web.hidden = YES;
    [self.host addSubview:session.web]; [self.sessions addObject:session];
    [self selectIndex:(NSInteger)self.sessions.count - 1];
}
- (void)selectIndex:(NSInteger)index {
    if (index < 0 || index >= (NSInteger)self.sessions.count) return;
    self.currentSession.web.hidden = YES;
    self.selected = index;
    GTSession *session = self.currentSession;
    session.web.hidden = NO; session.web.frame = self.host.bounds;
    [self.window makeFirstResponder:session.web];
    [session invoke:@"focus" args:@[]];
    [self refreshTabs];
    [self.tabs scrollRectToVisible:NSMakeRect(index * 150, 0, 150, 28)];
}
- (void)selectTab:(id)sender { (void)sender; [self selectIndex:self.tabs.selectedSegment]; }
- (void)refreshTabs {
    self.tabs.segmentCount = (NSInteger)self.sessions.count;
    for (NSInteger i = 0; i < (NSInteger)self.sessions.count; i++) {
        NSString *title = self.sessions[i].title;
        if (title.length > 23) title = [[title substringToIndex:22] stringByAppendingString:@"…"];
        [self.tabs setLabel:title forSegment:i];
        [self.tabs setToolTip:self.sessions[i].title forSegment:i];
    }
    self.tabs.selectedSegment = self.selected;
    self.window.title = [NSString stringWithFormat:@"%@ — Glass Terminal", self.currentSession.title ?: @"Оболочка"];
    [self layoutContent];
}
- (BOOL)confirmClose:(NSString *)what {
    NSAlert *alert = [[NSAlert alloc] init];
    alert.messageText = [NSString stringWithFormat:@"Закрыть %@?", what];
    alert.informativeText = @"Во вкладке выполняется программа. При закрытии её сеансу будет отправлен сигнал завершения.";
    [alert addButtonWithTitle:@"Отмена"]; [alert addButtonWithTitle:@"Закрыть"];
    return [alert runModal] == NSAlertSecondButtonReturn;
}
- (void)closeTab:(id)sender {
    (void)sender;
    GTSession *session = self.currentSession;
    if (!session) return;
    if (self.sessions.count == 1) { [self closeWindow:nil]; return; }
    if (session.hasForegroundJob && ![self confirmClose:@"вкладку"]) return;
    [session stop]; [session.web removeFromSuperview];
    NSInteger index = self.selected;
    [self.sessions removeObjectAtIndex:index]; self.selected = -1;
    [self selectIndex:MIN(index, (NSInteger)self.sessions.count - 1)];
}
- (BOOL)windowShouldClose:(NSWindow *)sender {
    (void)sender;
    if (self.closing) return YES;
    for (GTSession *session in self.sessions)
        if (session.hasForegroundJob) return [self confirmClose:@"окно"];
    return YES;
}
- (void)windowWillClose:(NSNotification *)notification {
    (void)notification; [self shutdown]; [self.app.windows removeObject:self];
}
- (void)windowDidEnterFullScreen:(NSNotification *)notification { (void)notification; [self applyAppearance]; }
- (void)windowDidExitFullScreen:(NSNotification *)notification { (void)notification; [self applyAppearance]; }
- (void)shutdown {
    self.closing = YES;
    for (GTSession *session in self.sessions) [session stop];
}
- (void)closeWindow:(id)sender {
    (void)sender;
    // A borderless window has no standard close button for performClose:.
    if ([self windowShouldClose:self.window]) [self.window close];
}
- (void)minimizeWindow:(id)sender { (void)sender; [self.window miniaturize:nil]; }
- (void)fullScreen:(id)sender { (void)sender; [self.window toggleFullScreen:nil]; }
- (void)copy:(id)sender { (void)sender; [self.currentSession invoke:@"copy" args:@[]]; }
- (void)pasteText:(NSString *)text {
    if (!text.length) return;
    if ([text lengthOfBytesUsingEncoding:NSUTF8StringEncoding] > 1024 * 1024) {
        ShowError(self.window, @"За один раз можно вставить до 1 МиБ текста."); return;
    }
    [self.currentSession invoke:@"paste" args:@[text]];
}
- (void)paste:(id)sender {
    (void)sender;
    [self pasteText:[NSPasteboard.generalPasteboard stringForType:NSPasteboardTypeString]];
}
- (void)find:(id)sender { (void)sender; [self.currentSession invoke:@"find" args:@[]]; }
- (void)terminalCopy:(id)sender { [self copy:sender]; }
- (void)terminalPaste:(id)sender { [self paste:sender]; }
- (void)terminalFind:(id)sender { [self find:sender]; }
- (void)terminalSelectAll:(id)sender { [self selectAll:sender]; }
- (void)clearScrollback:(id)sender { [self clear:sender]; }
- (void)selectAll:(id)sender { (void)sender; [self.currentSession invoke:@"selectAll" args:@[]]; }
- (void)clear:(id)sender { (void)sender; [self.currentSession invoke:@"clear" args:@[]]; }
- (void)nextTab:(id)sender { (void)sender; if (self.sessions.count) [self selectIndex:(self.selected + 1) % (NSInteger)self.sessions.count]; }
- (void)previousTab:(id)sender { (void)sender; if (self.sessions.count) [self selectIndex:(self.selected + (NSInteger)self.sessions.count - 1) % (NSInteger)self.sessions.count]; }
- (void)tabByNumber:(NSMenuItem *)sender { [self selectIndex:sender.tag - 1]; }
- (void)gt_adjustFontBy:(NSInteger)delta {
    NSUserDefaults *prefs = NSUserDefaults.standardUserDefaults;
    double size = delta ? [prefs doubleForKey:GTFontSize] + delta : 14;
    [prefs setDouble:MAX(10, MIN(30, size)) forKey:GTFontSize];
    [self.app applyAppearance];
}
- (void)largerFont:(id)sender { (void)sender; [self gt_adjustFontBy:1]; }
- (void)smallerFont:(id)sender { (void)sender; [self gt_adjustFontBy:-1]; }
- (void)resetFont:(id)sender { (void)sender; [self gt_adjustFontBy:0]; }
@end

static NSMenuItem *MenuEntry(NSMenu *menu, NSString *title, SEL action, NSString *key, id target) {
    NSMenuItem *item = [menu addItemWithTitle:title action:action keyEquivalent:key];
    item.target = target;
    return item;
}
@implementation GTAppDelegate
- (void)applicationDidFinishLaunching:(NSNotification *)notification {
    (void)notification;
    self.windows = [NSMutableArray array];
    [NSUserDefaults.standardUserDefaults registerDefaults:@{GTOpacity:@0.18, GTRadius:@26, GTFontSize:@14, GTBlur:@YES}];
    NSMenu *bar = [[NSMenu alloc] initWithTitle:@""];
    NSMenuItem *applicationItem = [[NSMenuItem alloc] init]; [bar addItem:applicationItem];
    NSMenu *application = [[NSMenu alloc] initWithTitle:@"Glass Terminal"]; applicationItem.submenu = application;
    MenuEntry(application, @"О Glass Terminal", @selector(orderFrontStandardAboutPanel:), @"", NSApp);
    MenuEntry(application, @"Оформление…", @selector(showSettings:), @",", self);
    [application addItem:NSMenuItem.separatorItem];
    MenuEntry(application, @"Скрыть Glass Terminal", @selector(hide:), @"h", NSApp);
    MenuEntry(application, @"Завершить Glass Terminal", @selector(terminate:), @"q", NSApp);
    NSMenu *file = [[NSMenu alloc] initWithTitle:@"Файл"];
    NSMenuItem *fileItem = [[NSMenuItem alloc] initWithTitle:@"Файл" action:NULL keyEquivalent:@""]; fileItem.submenu = file; [bar addItem:fileItem];
    MenuEntry(file, @"Новое окно", @selector(newWindow:), @"n", self);
    MenuEntry(file, @"Новая вкладка", @selector(newTab:), @"t", nil);
    MenuEntry(file, @"Закрыть вкладку", @selector(closeTab:), @"w", nil);
    NSMenu *edit = [[NSMenu alloc] initWithTitle:@"Правка"];
    NSMenuItem *editItem = [[NSMenuItem alloc] initWithTitle:@"Правка" action:NULL keyEquivalent:@""]; editItem.submenu = edit; [bar addItem:editItem];
    MenuEntry(edit, @"Копировать", @selector(terminalCopy:), @"c", nil);
    MenuEntry(edit, @"Вставить", @selector(terminalPaste:), @"v", nil);
    MenuEntry(edit, @"Выделить всё", @selector(terminalSelectAll:), @"a", nil);
    MenuEntry(edit, @"Найти…", @selector(terminalFind:), @"f", nil);
    MenuEntry(edit, @"Очистить историю вывода", @selector(clearScrollback:), @"k", nil);
    NSMenu *view = [[NSMenu alloc] initWithTitle:@"Вид"];
    NSMenuItem *viewItem = [[NSMenuItem alloc] initWithTitle:@"Вид" action:NULL keyEquivalent:@""]; viewItem.submenu = view; [bar addItem:viewItem];
    MenuEntry(view, @"Увеличить шрифт", @selector(largerFont:), @"=", nil);
    MenuEntry(view, @"Уменьшить шрифт", @selector(smallerFont:), @"-", nil);
    MenuEntry(view, @"Обычный размер шрифта", @selector(resetFont:), @"0", nil);
    NSMenuItem *fullscreen = MenuEntry(view, @"Полноэкранный режим", @selector(fullScreen:), @"f", nil);
    fullscreen.keyEquivalentModifierMask = NSEventModifierFlagCommand | NSEventModifierFlagControl;
    NSMenu *windows = [[NSMenu alloc] initWithTitle:@"Окно"];
    NSMenuItem *windowItem = [[NSMenuItem alloc] initWithTitle:@"Окно" action:NULL keyEquivalent:@""]; windowItem.submenu = windows; [bar addItem:windowItem];
    MenuEntry(windows, @"Свернуть", @selector(minimizeWindow:), @"m", nil);
    NSMenuItem *previous = MenuEntry(windows, @"Предыдущая вкладка", @selector(previousTab:), @"[", nil);
    previous.keyEquivalentModifierMask = NSEventModifierFlagCommand | NSEventModifierFlagShift;
    NSMenuItem *next = MenuEntry(windows, @"Следующая вкладка", @selector(nextTab:), @"]", nil);
    next.keyEquivalentModifierMask = NSEventModifierFlagCommand | NSEventModifierFlagShift;
    for (NSInteger i = 1; i <= 9; i++) {
        NSMenuItem *item = MenuEntry(windows, [NSString stringWithFormat:@"Вкладка %ld", (long)i], @selector(tabByNumber:), [NSString stringWithFormat:@"%ld", (long)i], nil);
        item.tag = i;
    }
    NSApp.mainMenu = bar; NSApp.windowsMenu = windows;
    __weak GTAppDelegate *weak = self;
    self.timer = [NSTimer timerWithTimeInterval:1.0 / 60 repeats:YES block:^(NSTimer *timer) {
        (void)timer;
        for (GTWindowController *window in [weak.windows copy])
            for (GTSession *session in [window.sessions copy]) [session pump];
    }];
    [NSRunLoop.mainRunLoop addTimer:self.timer forMode:NSRunLoopCommonModes];
    [self newWindow:nil]; [NSApp activateIgnoringOtherApps:YES];
}
- (void)newWindow:(id)sender {
    (void)sender;
    GTWindowController *controller = [[GTWindowController alloc] initWithApp:self];
    [self.windows addObject:controller];
}
- (BOOL)applicationShouldHandleReopen:(NSApplication *)sender hasVisibleWindows:(BOOL)visible {
    (void)sender;
    if (!visible) [self newWindow:nil]; return YES;
}
- (BOOL)applicationShouldTerminateAfterLastWindowClosed:(NSApplication *)sender { (void)sender; return NO; }
- (NSApplicationTerminateReply)applicationShouldTerminate:(NSApplication *)sender {
    (void)sender;
    NSUInteger count = 0;
    for (GTWindowController *window in self.windows)
        for (GTSession *session in window.sessions) if (session.isRunning) count++;
    if (count) {
        NSAlert *alert = [[NSAlert alloc] init];
        alert.messageText = @"Завершить Glass Terminal?";
        alert.informativeText = [NSString stringWithFormat:@"Будут закрыты сеансы оболочки: %lu.", (unsigned long)count];
        [alert addButtonWithTitle:@"Отмена"]; [alert addButtonWithTitle:@"Завершить"];
        if ([alert runModal] != NSAlertSecondButtonReturn) return NSTerminateCancel;
    }
    for (GTWindowController *window in self.windows) [window shutdown];
    [self.timer invalidate]; return NSTerminateNow;
}
- (void)applyAppearance { for (GTWindowController *window in self.windows) [window applyAppearance]; }
- (void)showSettings:(id)sender {
    (void)sender;
    if (self.settingsPanel) { [self.settingsPanel makeKeyAndOrderFront:nil]; return; }
    NSPanel *panel = [[NSPanel alloc] initWithContentRect:NSMakeRect(0, 0, 470, 285)
        styleMask:NSWindowStyleMaskTitled | NSWindowStyleMaskClosable backing:NSBackingStoreBuffered defer:NO];
    panel.title = @"Оформление Glass Terminal"; panel.releasedWhenClosed = NO;
    panel.appearance = [NSAppearance appearanceNamed:NSAppearanceNameDarkAqua];
    self.settingValues = [NSMutableArray array];
    NSArray *labels = @[@"Затемнение фона", @"Радиус углов", @"Размер шрифта"];
    NSArray *keys = @[GTOpacity, GTRadius, GTFontSize];
    double minima[] = {0, 8, 10}, maxima[] = {1, 40, 30};
    for (NSInteger i = 0; i < 3; i++) {
        CGFloat y = 226 - i * 54;
        NSTextField *label = [NSTextField labelWithString:labels[i]];
        label.frame = NSMakeRect(22, y + 8, 150, 20); [panel.contentView addSubview:label];
        NSSlider *slider = [NSSlider sliderWithValue:[NSUserDefaults.standardUserDefaults doubleForKey:keys[i]]
            minValue:minima[i] maxValue:maxima[i] target:self action:@selector(settingChanged:)];
        slider.tag = i; slider.continuous = YES; slider.frame = NSMakeRect(181, y + 5, 205, 24);
        slider.accessibilityLabel = labels[i]; [panel.contentView addSubview:slider];
        NSTextField *value = [NSTextField labelWithString:i == 0 ? [NSString stringWithFormat:@"%.0f%%", slider.doubleValue * 100] : [NSString stringWithFormat:@"%.0f", slider.doubleValue]];
        value.frame = NSMakeRect(398, y + 8, 58, 20); [panel.contentView addSubview:value]; [self.settingValues addObject:value];
    }
    NSButton *blur = [NSButton checkboxWithTitle:@"Размывать фон за окном" target:self action:@selector(settingChanged:)];
    blur.tag = 3; blur.state = [NSUserDefaults.standardUserDefaults boolForKey:GTBlur] ? NSControlStateValueOn : NSControlStateValueOff;
    blur.frame = NSMakeRect(22, 66, 320, 24); [panel.contentView addSubview:blur];
    NSTextField *hint = [NSTextField wrappingLabelWithString:@"0% затемнения — полностью прозрачный фон без размытия. Текст сохраняет свою непрозрачность."];
    hint.textColor = NSColor.secondaryLabelColor; hint.font = [NSFont systemFontOfSize:11];
    hint.frame = NSMakeRect(22, 15, 426, 40); [panel.contentView addSubview:hint];
    self.settingsPanel = panel; [panel center]; [panel makeKeyAndOrderFront:nil];
}
- (void)settingChanged:(NSControl *)sender {
    NSUserDefaults *prefs = NSUserDefaults.standardUserDefaults;
    if (sender.tag == 3) [prefs setBool:[(NSButton *)sender state] == NSControlStateValueOn forKey:GTBlur];
    else if (sender.tag >= 0 && sender.tag < 3) {
        NSArray *keys = @[GTOpacity, GTRadius, GTFontSize];
        double value = sender.tag == 0 ? sender.doubleValue : round(sender.doubleValue);
        [prefs setDouble:value forKey:keys[sender.tag]];
        self.settingValues[sender.tag].stringValue = sender.tag == 0 ?
            [NSString stringWithFormat:@"%.0f%%", value * 100] : [NSString stringWithFormat:@"%.0f", value];
    }
    [self applyAppearance];
}
@end

int main(void) {
    @autoreleasepool {
        signal(SIGPIPE, SIG_IGN);
        NSApplication *application = NSApplication.sharedApplication;
        [application setActivationPolicy:NSApplicationActivationPolicyRegular];
        __attribute__((objc_precise_lifetime)) GTAppDelegate *delegate = [[GTAppDelegate alloc] init];
        application.delegate = delegate;
        [application run];
        (void)delegate;
    }
    return 0;
}
