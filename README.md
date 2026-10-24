# Афиша Муз. театра Карелии — PWA

Статичное веб-приложение (PWA): афиша театра (mrteatr.ru) + лента постов хоровой
группы ВК. Данные обновляются раз в день через GitHub Actions и кладутся в
`app/data/*.json`. Приложение работает офлайн — последние скачанные данные
хранятся в кэше браузера.

Ставится на Android через «Добавить на главный экран» в Chrome (иконка как у
обычного приложения) и открывается в браузере на ПК — один и тот же код.

## Структура

- `app/` — сама PWA (статика): `index.html`, `app.js`, `styles.css`,
  `service-worker.js`, `manifest.webmanifest`, `data/*.json`.
- `scripts/update-afisha.mjs` — тянет афишу с `mrteatr.ru` (их собственный
  публичный JSON API `/api/v1/affiche` + данные о составе/дирижёре со страницы
  спектакля).
- `scripts/update-vk.mjs` — тянет последние посты группы ВК через
  `wall.get` (**только чтение**, ничего никогда не публикует).
- `.github/workflows/update-data.yml` — раз в день (и вручную) запускает оба
  скрипта, коммитит `data/*.json`, деплоит `app/` на GitHub Pages.

## Разовая настройка

1. **GitHub Pages**: Settings → Pages → Source → `GitHub Actions`.
2. **VK токен** (Settings → Secrets and variables → Actions → New repository secret):
   - `VK_GROUP_DOMAIN` — короткое имя группы из ссылки `vk.com/<имя>`.
   - `VK_TOKEN` — токен сообщества с правом **"Стена"**. Получить:
     группа → «Управление сообществом» → «Работа с API» → «Создать ключ» →
     отметить доступ к стене → скопировать ключ. Токен привязан к группе,
     отдельный VK-аккаунт/пароль никому вводить не нужно.
3. Запустить workflow вручную первый раз: вкладка **Actions** → `Update data
   and deploy` → **Run workflow**.
4. Готовый адрес приложения: `https://<ваш-логин>.github.io/<репозиторий>/`.

## Локальный запуск для разработки

```bash
node scripts/update-afisha.mjs      # обновит app/data/afisha.json
VK_GROUP_DOMAIN=xxx VK_TOKEN=xxx node scripts/update-vk.mjs
node scripts/dev-server.mjs         # http://localhost:8098
```

## Android: APK и виджет на главный экран

Нативная Android-обёртка (TWA — Trusted Web Activity) с настоящим системным
виджетом лежит отдельно от этого репозитория, в `C:\dev\mrteatr-afisha-android`
(вне git — там Android SDK/Gradle кэш, слишком большой для репозитория).

- Open-режим приложения — та же страница из `app/`, просто в обёртке без
  адресной строки (подтверждается через `app/.well-known/assetlinks.json`).
- Виджет: `app/src/main/java/.../AfishaWidgetProvider.java` — раз в 6 часов
  тянет `data/afisha.json` и показывает ближайший спектакль.
- Подписано одним и тем же ключом: `android-release/signing.keystore`
  (пароль и алиас — в `android-release/signing-key-info.txt`, **храните в
  надёжном месте**, он нужен для всех будущих обновлений apk/aab, иначе
  Android откажется ставить новую версию поверх старой).

Локальная пересборка после правок на сайте (меняется `web_manifest_url` —
значит и Android-обёртка может взять новые данные без пересборки, а вот
изменения в `AndroidManifest.xml`/Java-коде требуют пересборки):

```bash
# один раз: Android SDK в C:\Android, JDK 17 через winget (Microsoft.OpenJDK.17)
cd /c/dev/mrteatr-afisha-android
JAVA_HOME="/c/Program Files/Microsoft/jdk-17.0.20.101-hotspot" \
ANDROID_HOME="/c/Android" ANDROID_SDK_ROOT="/c/Android" \
  ./gradlew.bat assembleRelease
# затем zipalign + apksigner с ключом android-release/signing.keystore
# (пароль/алиас — в signing-key-info.txt рядом).
```

## Известные ограничения

- Фото-расписания из ВК показываются как есть (картинка + текст поста), без
  распознавания текста на фото (OCR). Можно добавить позже, но результат
  распознавания рукописных/оформленных скринов ненадёжен.
