<template>
 <section class="creative-config">
  <h2>剧本与生图配置</h2>
  <p>剧本文字生成使用已有模型线路，以下参数控制时长对应的输出预算。</p>
  <label>每秒输出 token<input v-model.number="screenplay.tokensPerSecond" type="number" min="1" max="1000" /></label>
  <label>最低输出 token<input v-model.number="screenplay.minimumTokens" type="number" min="256" /></label>
  <div v-for="model in images.models" :key="model.id" class="image-model">
   <h3>{{ model.alias }}</h3>
   <label>接口地址<input v-model.trim="model.baseUrl" placeholder="https://example.com/v1" /></label>
   <label>模型名<input v-model.trim="model.model" /></label>
   <label>API Key<input v-model.trim="model.apiKey" type="password" :placeholder="model.apiKeyConfigured ? '已配置，留空保留原密钥' : '未配置'" autocomplete="new-password" /></label>
  </div>
  <button :disabled="busy" @click="save">{{ busy ? '保存中…' : '保存剧本和生图配置' }}</button><p role="status">{{ message }}</p>
 </section>
</template>
<script setup>
import { ref, onMounted } from 'vue'
import api from '../api'
const screenplay = ref({ tokensPerSecond: 32, minimumTokens: 7000 })
const images = ref({ models: [] }), busy = ref(false), message = ref('')
onMounted(async () => { try { const [text, image] = await Promise.all([api.get('/admin/screenplay-generation'), api.get('/admin/image-generation')]); screenplay.value = text.data; images.value = { ...image.data, models: image.data.models.map(model => ({ ...model, apiKey: '' })) } } catch { message.value = '新创作功能尚未部署到后端' } })
async function save() { busy.value = true; try { await api.put('/admin/screenplay-generation', screenplay.value); const res = await api.put('/admin/image-generation', images.value); images.value = { ...res.data, models: res.data.models.map(model => ({ ...model, apiKey: '' })) }; message.value = '配置已保存' } catch (error) { message.value = error.response?.data?.message || '保存失败' } finally { busy.value = false } }
</script>
<style scoped>
.creative-config { margin-top:24px; padding:20px; border:1px solid #ddd; border-radius:12px; }
label { display:block; margin:12px 0; } input { display:block; width:100%; padding:10px; border:1px solid #ddd; border-radius:6px; }
.image-model { margin:18px 0; }
</style>
