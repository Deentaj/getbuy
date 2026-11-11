import { defineConfig } from 'vite';

export default defineConfig({
  envDir: '..',
  envPrefix: ['VITE_', 'EXPO_PUBLIC_'],
});
