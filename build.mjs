import * as esbuild from "esbuild";
import { copyFileSync, mkdirSync, readdirSync, statSync, existsSync } from "fs";
import { join, dirname } from "path";

const isWatch = process.argv.includes("--watch");

const entryPoints = [
  "background.js",
  "scripts/content.js",
  "popup/popup.js",
];

const staticFiles = [
  "manifest.json",
  "popup/popup.html",
  "popup/popup.css",
];

const staticDirs = ["assets"];

async function copyStatic() {
  for (const file of staticFiles) {
    const dest = join("dist", file);
    mkdirSync(dirname(dest), { recursive: true });
    copyFileSync(file, dest);
  }

  for (const dir of staticDirs) {
    copyDirSync(dir, join("dist", dir));
  }
}

function copyDirSync(src, dest) {
  if (!existsSync(src)) return;
  mkdirSync(dest, { recursive: true });

  for (const entry of readdirSync(src)) {
    const srcPath = join(src, entry);
    const destPath = join(dest, entry);

    if (statSync(srcPath).isDirectory()) {
      copyDirSync(srcPath, destPath);
    } else {
      copyFileSync(srcPath, destPath);
    }
  }
}

const ctx = await esbuild.context({
  entryPoints,
  bundle: true,
  minify: true,
  outdir: "dist",
  outbase: ".",
  target: ["chrome112"],
  format: "esm",
  allowOverwrite: true,
  plugins: [
    {
      name: "copy-static",
      setup(build) {
        build.onEnd(async () => {
          try {
            await copyStatic();
            console.log("Build complete: dist/");
          } catch (err) {
            console.error("Copy failed:", err);
          }
        });
      },
    },
  ],
});

if (isWatch) {
  await ctx.watch();
  console.log("Watching for changes...");
} else {
  await ctx.rebuild();
  ctx.dispose();
}