<template>
  <view class="app">
    <!-- pages 由 uni-app 自动加载 -->
    <slot />
  </view>
</template>

<script setup>
</script>

<style>
/* ====== 全局变量 ====== */
:root {
  --primary-color: #FF6B35;
  --primary-light: #fff5f0;
  --text-primary: #333;
  --text-secondary: #666;
  --text-light: #999;
  --card-bg: #fff;
  --border-color: #f0f0f0;
  --error-color: #ff4d4f;
  --success-color: #52c41a;
  --header-height: 44px;
  --tab-height: 50px;
  --safe-bottom: env(safe-area-inset-bottom, 0px);
}

page {
  background: #f8f8f8;
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
  color: var(--text-primary);
  font-size: 14px;
  line-height: 1.5;
  -webkit-font-smoothing: antialiased;
}

/* ====== 通用组件 ====== */
.card {
  background: var(--card-bg);
  border-radius: 12px;
  padding: 16px;
  margin: 8px 12px;
  box-shadow: 0 1px 4px rgba(0,0,0,0.04);
}

.btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 10px 20px;
  border-radius: 8px;
  font-size: 14px;
  font-weight: 500;
  border: none;
  cursor: pointer;
  font-family: inherit;
  transition: all 0.2s;
}

.btn-primary {
  background: var(--primary-color);
  color: white;
}

.btn-outline {
  background: transparent;
  border: 1px solid var(--border-color);
  color: var(--text-primary);
}

.btn-block {
  display: flex;
  width: 100%;
}

.btn-sm {
  padding: 6px 12px;
  font-size: 12px;
}

.btn-lg {
  padding: 14px 24px;
  font-size: 16px;
}

.input {
  width: 100%;
  padding: 10px 12px;
  border: 1px solid var(--border-color);
  border-radius: 8px;
  font-size: 14px;
  outline: none;
  box-sizing: border-box;
  background: #fafafa;
}

.textarea {
  width: 100%;
  padding: 12px;
  border: 1px solid var(--border-color);
  border-radius: 8px;
  font-size: 14px;
  line-height: 1.6;
  outline: none;
  box-sizing: border-box;
  background: #fafafa;
  font-family: inherit;
  resize: vertical;
}

.empty-state {
  text-align: center;
  padding: 60px 20px;
}

.empty-state .icon {
  font-size: 48px;
  margin-bottom: 12px;
}

.empty-state .text {
  font-size: 14px;
  color: var(--text-light);
}

.section-title {
  font-size: 15px;
  font-weight: 600;
  color: var(--text-primary);
  margin-bottom: 12px;
}

.page-header {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  height: var(--header-height);
  background: var(--card-bg);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 16px;
  font-weight: 600;
  border-bottom: 1px solid var(--border-color);
  z-index: 100;
}

.page-container {
  padding-top: var(--header-height);
  padding-bottom: calc(var(--tab-height) + 20px);
  min-height: 100vh;
}

.loading-spinner {
  width: 32px;
  height: 32px;
  border: 3px solid var(--border-color);
  border-top-color: var(--primary-color);
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
  margin: 0 auto;
}

@keyframes spin {
  to { transform: rotate(360deg); }
}
</style>
