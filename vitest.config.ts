import { defineConfig } from 'vitest/config';

// client/tsconfig.json 继承 Cocos 生成的 temp/tsconfig.cocos.json（打开 Cocos 后才有），
// 所以这里给 esbuild 一份固定配置，不去读 client/ 下的 tsconfig。
export default defineConfig({
  esbuild: {
    tsconfigRaw: JSON.stringify({ compilerOptions: { target: 'es2017', experimentalDecorators: true, useDefineForClassFields: false } }),
  },
  test: {
    include: ['tests/**/*.test.ts'],
  },
});
