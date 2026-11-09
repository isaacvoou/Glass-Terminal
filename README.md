# Glass Terminal

Прозрачный терминал со скруглённым оформлением, вкладками, поиском и настоящими сеансами оболочки.

В репозитории две версии:

- **Desktop 0.2.0:** Windows, macOS и Linux. Electron, xterm.js и нативный модуль node-pty (Node-API; ConPTY на Windows, PTY на Unix).
- **Native macOS 0.1.1:** исходная версия на C и Objective-C/AppKit в `native-macos/`. Включает исправление конфликта метода `changeFont:` и поддержку собственной иконки.

## Скачать установщики

Откройте [Actions → Build installers](https://github.com/isaacvoou/Glass-Terminal/actions/workflows/installers.yml), выберите завершённую зелёную сборку и скачайте нужный ZIP в разделе **Artifacts**. Для скачивания артефактов GitHub нужно войти в аккаунт. Артефакты хранятся 30 дней; новую сборку можно запустить через **Run workflow** после попадания workflow в основную ветку, либо новым коммитом в `main` или `codex/**`.

| Система | Артефакт Actions | Установочные файлы |
| --- | --- | --- |
| Windows 10 22H2 / Windows 11, x64 | `Glass-Terminal-win-x64` | Desktop: `.exe` (мастер установки NSIS) |
| macOS 13+, Intel | `Glass-Terminal-mac-x64` | Desktop: `.dmg`, `.zip`; Native: `.dmg`, `.pkg` |
| macOS 13+, Apple Silicon | `Glass-Terminal-mac-arm64` | Desktop: `.dmg`, `.zip`; Native: `.dmg`, `.pkg` |
| Ubuntu 22.04+ / совместимый Linux x64 | `Glass-Terminal-linux-x64` | `.deb` и `.AppImage` |

Файлы `SHA256SUMS-*.txt` содержат контрольные суммы. `.deb` предназначен для Debian/Ubuntu-совместимых дистрибутивов; `.AppImage` требует совместимого glibc и поддержки FUSE либо стандартного режима извлечения AppImage. Это не сборка для абсолютно любого Linux.

Установщики Windows пока не имеют подписи доверенного издателя. macOS-приложения подписаны локальной ad-hoc подписью, но не имеют Developer ID и нотариального заверения Apple; `.pkg` также без подписи издателя. При распространении таких файлов системы могут показать предупреждение. Эта сборка не отключает Gatekeeper, SmartScreen или sandbox. Для доверенной массовой дистрибуции нужно отдельно настроить собственные сертификаты и нотариальное заверение.

## Установка

- **Windows:** запустите `.exe`, выберите папку и завершите мастер. Установка выполняется для текущего пользователя.
- **macOS Desktop:** откройте `.dmg` и перенесите приложение в «Программы». Для своего Mac выбирайте `arm64` (Apple Silicon) либо `x64` (Intel).
- **macOS Native:** выбирайте файл с `Native` в имени. `.dmg` позволяет перенести приложение вручную; `.pkg` устанавливает его в `/Applications` стандартным установщиком macOS.
- **Linux Debian/Ubuntu:** установите скачанный пакет через графический установщик либо `sudo apt install ./Glass-Terminal-0.2.0-linux-amd64.deb`. Для AppImage разрешите запуск файла как программы и откройте его.

На компьютере пользователя Node.js, компилятор и исходники не нужны: они требуются только для сборки.

## Изменить иконку

Подготовьте **квадратный PNG 1024×1024** с прозрачным фоном либо квадратный SVG. Откройте папку исходников и выполните:

```sh
npm ci
npm run icons -- "/путь/к/моей-иконке.png"
```

Команда копирует исходник иконки в `assets/icon-source.*`, сохраняет выбор в `assets/icon-source.json`, создаёт `assets/icon.png`, `build-resources/icon.ico`, `build-resources/icon.icns` и PNG разных размеров для Linux. Выбор сохраняется при следующих сборках. Не редактируйте файлы внутри установленного `.app` или `.exe` — меняйте исходную иконку и пересобирайте приложение.

Затем соберите установщик на нужной системе:

```sh
npm run dist:win     # Windows
npm run dist:mac     # macOS, текущая архитектура
npm run dist:linux   # Linux x64
```

Либо добавьте новую исходную иконку и `assets/icon-source.json` в GitHub и запустите сборку Actions. Генерируемые `build-resources/` в Git добавлять не требуется. Для возврата к исходной иконке удалите `assets/icon-source.json`, затем запустите `npm run icons`.

Для **исходной нативной версии macOS** замените `native-macos/assets/icon.png` и выполните `sh native-macos/scripts/package.sh` на Mac. В GitHub Actions иконка из общего `assets/icon.png` автоматически передаётся нативной версии. Для временной смены только иконки ярлыка Windows можно использовать его «Свойства → Ярлык → Сменить значок» с `.ico`; это не меняет иконку внутри `.exe`.

## Возможности Desktop

- Прозрачность фона и CSS-скругления 8–40 пикселей, непрозрачный текст, изменение шрифта и сохранение настроек.
- Системное размытие на macOS и Windows 11 (поддерживаемые сборки). На Windows 10 и Linux прозрачность доступна без обещания системного размытия; конечный вид зависит от композитора, GPU и настроек доступности.
- До 32 вкладок в окне, отдельные оболочки, поиск, выделение, копирование и bracketed paste.
- Windows запускает установленный Windows PowerShell. macOS/Linux — оболочку учётной записи пользователя с `-l`. Новые вкладки начинают работу в домашней папке.
- Unicode, ANSI-цвета, альтернативный экран, прокрутка 10 000 строк, передача размера PTY и ввод Ctrl+C.
- Ограничение потока вывода через `pause`/`resume` и подтверждения обработки xterm.js.

Функциональность разных изданий не полностью совпадает. Desktop пока не переносит перетаскивание файлов из Native macOS и не реализует восстановление сеансов. Ни одно издание не является полной копией Terminal.app. Совместимость управляющих последовательностей определяется xterm.js.

**Клавиши:** на Mac — ⌘T/N/W, ⌘C/V/F; на Windows/Linux — Ctrl+Shift+T/N/W, Ctrl+Shift+C/V/F. Ctrl+C остаётся прерыванием программы. Ctrl+Tab переключает вкладки; Cmd/Ctrl+1…9 выбирает вкладку. Масштаб шрифта: Cmd/Ctrl+= и Cmd/Ctrl+−, сброс — Cmd/Ctrl+0. Настройки открываются кнопкой справа в заголовке.

## Сборка из исходников

Требуется Node.js 24. На Linux нужны Python 3, make и C++-компилятор для сборки node-pty. Для macOS Native нужны Xcode Command Line Tools. На Windows/macOS node-pty использует включённые в его npm-пакет готовые Node-API-библиотеки для правильной архитектуры. В Actions каждый пакет собирается на своей ОС; бинарники из другой системы не переиспользуются.

```sh
npm ci
npm run prepare:assets
npm test
npm run test:pty
npm run test:app
npm run dist:linux   # замените на dist:win или dist:mac
npm run test:packaged
```

Для теста GUI в Linux CI используйте `xvfb-run -a npm run test:app` и аналогично для `test:packaged`. В обычном настольном сеансе это не нужно. Все установщики находятся в `dist/`; для Native macOS — в `native-macos/dist/`.

node-pty 1.1 использует стабильный Node-API. Поэтому `npmRebuild: false` отключает лишнюю пересборку для V8 ABI; `scripts/setup.cjs` проверяет загрузку нативного модуля, а `test:pty` и `test:app` запускают его в самом Electron. Зависимости закреплены в `package-lock.json`.

## Проверки и границы

`npm test` проверяет параметры, ссылки, размеры терминала и форматы иконок. `test:pty` работает с настоящими оболочками через нативный node-pty. `test:app` запускает приложение, передаёт команду оболочке и проверяет вывод xterm.js, вкладки, поиск и сохранение настроек. `test:packaged` повторяет это с упакованными ресурсами и нативными модулями из `app.asar`/`app.asar.unpacked`.

Изолированный renderer работает без Node.js с `contextIsolation` и sandbox; IPC проверяет основной локальный документ и владельца сеанса. CSP запрещает сетевые запросы страницы; вывод терминала не вставляется как HTML. OSC 52 не пишет в системный буфер обмена. Данные настроек сохраняются в каталоге пользовательских данных приложения.

GitHub Actions проверяет сборку на размещённых runners. Это не заменяет проверку прозрачности, GPU, установщика и поведения окон на физических Windows 10/11, разных Mac и Linux-композиторах.

Документация: [Electron](https://www.electronjs.org/docs/latest/), [ограничения прозрачных окон](https://www.electronjs.org/docs/latest/tutorial/custom-window-styles), [node-pty](https://github.com/microsoft/node-pty), [electron-builder](https://www.electron.build/v26/docs/).
