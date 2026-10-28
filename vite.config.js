import { defineConfig } from "vite";

/*
  Phase 0：只做构建与发布，不碰业务代码。
  base 用相对路径 —— GitHub Pages 的站点在 /licai-ledger/ 子路径下，
  相对 base 对根路径部署同样成立，省掉一处环境差异。
*/
export default defineConfig({
  base: "./",
  build: {
    outDir: "dist",
    emptyOutDir: true,
    // Phase 0 不压缩也不改名：产物要能和线上现状逐字节对比
    minify: false,
    assetsDir: "assets",
  },
});
