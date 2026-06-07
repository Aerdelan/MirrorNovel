# 番茄小说AI - App

## 开发

```bash
cd app
npm install --legacy-peer-deps
npm run dev:h5    # H5 开发，端口 5175
```

## 构建 APK

### 方式一：GitHub Actions（推荐）

推送 `app/` 目录的改动到 GitHub 的 `main` 分支，会在 Actions 中自动构建 APK。
构建完成后，在 Actions 页面下载 `fanqiexiaoshuo-app` 工件。

### 方式二：本地构建

需要安装：
1. **Node.js 20+**
2. **Java 17**（[下载](https://adoptium.net/)）
3. **Android Studio**（含 Android SDK 35）

```bash
cd app
npm install --legacy-peer-deps
npm run build:h5
npx cap sync android
cd android
./gradlew assembleDebug
# APK 输出: android/app/build/outputs/apk/debug/app-debug.apk
```

### 方式三：Android Studio

```bash
cd app
npm run build:h5
npx cap sync android
npx cap open android   # 用 Android Studio 打开
# Android Studio 中: Build → Build Bundle(s) / APK → Build APK
```

## 架构

```
app/
├── src/api/         # API 客户端（自动适配 H5 / 原生）
├── src/stores/      # Pinia 状态管理
├── src/pages/       # 8 个页面
├── src/utils/       # 工具函数
├── capacitor.config.json  # Capacitor 配置
├── android/         # Android 原生项目（Capacitor 生成）
└── dist/build/h5/   # H5 构建产物
```

API 地址自动切换：
- **H5 开发** → `/api`（Vite 代理到 localhost:3001）
- **原生 App** → `http://43.159.149.223:3001/api`（直连服务器）
