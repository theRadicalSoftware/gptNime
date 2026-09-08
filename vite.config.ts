import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { wcoPlugin } from './server/wco'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), wcoPlugin()],
})
