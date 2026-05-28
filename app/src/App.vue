<template>
  <view class="app">
    <slot />
  </view>
</template>

<script setup>
</script>

<style>
/* ====== 全局变量 ====== */
:root {
  --primary-color: #FF6B35;
  --primary-dark: #e55a2b;
  --primary-light: #fff5f0;
  --text-primary: #1a1a2e;
  --text-secondary: #555;
  --text-light: #999;
  --card-bg: #fff;
  --border-color: #eee;
  --error-color: #ff4d4f;
  --success-color: #52c41a;
  --header-height: 44px;
  --tab-height: 50px;
  --safe-bottom: env(safe-area-inset-bottom, 0px);
  --shadow-sm: 0 2px 8px rgba(0,0,0,0.06);
  --radius: 12px;
}

page {
  background: #f5f5f7;
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'PingFang SC', 'Microsoft YaHei', sans-serif;
  color: var(--text-primary);
  font-size: 14px;
  line-height: 1.5;
  -webkit-font-smoothing: antialiased;
  -webkit-overflow-scrolling: touch;
}

/* ====== 通用组件 ====== */
.card {
  background: var(--card-bg);
  border-radius: var(--radius);
  padding: 16px;
  margin: 8px 12px;
  box-shadow: var(--shadow-sm);
}

.btn {
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 12px 20px;
  border-radius: 10px;
  font-size: 15px;
  font-weight: 600;
  border: none;
  font-family: inherit;
  transition: all 0.2s;
  position: relative;
  overflow: hidden;
}

.btn-hover {
  opacity: 0.85;
  transform: scale(0.97);
}

.btn-primary {
  background: linear-gradient(135deg, var(--primary-color), #ff8a5c);
  color: white;
  box-shadow: 0 4px 12px rgba(255,107,53,0.3);
}

.btn-primary[disabled] {
  opacity: 0.5;
  box-shadow: none;
}

.btn-outline {
  background: transparent;
  border: 1.5px solid var(--border-color);
  color: var(--text-primary);
}

.btn-block {
  width: 100%;
}

.btn-sm {
  padding: 8px 14px;
  font-size: 12px;
  border-radius: 8px;
}

.btn-lg {
  padding: 16px 24px;
  font-size: 17px;
  border-radius: 12px;
}

/* ====== 输入框 ====== */
.input {
  width: 100%;
  padding: 14px 16px;
  border: 1.5px solid var(--border-color);
  border-radius: 10px;
  font-size: 15px;
  outline: none;
  box-sizing: border-box;
  background: #f8f8fa;
  color: var(--text-primary);
  transition: border-color 0.2s;
}

.input:focus {
  border-color: var(--primary-color);
  background: white;
}

.textarea {
  width: 100%;
  padding: 14px 16px;
  border: 1.5px solid var(--border-color);
  border-radius: 10px;
  font-size: 14px;
  line-height: 1.6;
  outline: none;
  box-sizing: border-box;
  background: #f8f8fa;
  font-family: inherit;
  color: var(--text-primary);
  transition: border-color 0.2s;
}

.textarea:focus {
  border-color: var(--primary-color);
  background: white;
}

/* ====== 通用布局 ====== */
.page-container {
  padding-top: var(--header-height);
  padding-bottom: calc(var(--tab-height) + 24px);
  min-height: 100vh;
}

.page-header {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  height: var(--header-height);
  background: rgba(255,255,255,0.96);
  backdrop-filter: blur(10px);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 17px;
  font-weight: 600;
  border-bottom: 0.5px solid var(--border-color);
  z-index: 100;
}

.empty-state {
  text-align: center;
  padding: 60px 20px;
  display: flex;
  flex-direction: column;
  align-items: center;
}

.empty-state .icon {
  font-size: 56px;
  margin-bottom: 16px;
}

.empty-state .text {
  font-size: 15px;
  color: var(--text-light);
}

.section-title {
  font-size: 15px;
  font-weight: 600;
  color: var(--text-primary);
  margin-bottom: 12px;
}

.loading-spinner {
  width: 32px;
  height: 32px;
  border: 3px solid #eee;
  border-top-color: var(--primary-color);
  border-radius: 50%;
  animation: spin 0.7s linear infinite;
  margin: 0 auto;
}

@keyframes spin {
  to { transform: rotate(360deg); }
}
</style>
