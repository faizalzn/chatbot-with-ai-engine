import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { build, context, transform } from "esbuild";

const here = import.meta.dirname;
const watch = process.argv.includes("--watch");

/** CSS widget disisipkan ke Shadow DOM sebagai teks, jadi dimuat sebagai string yang sudah diperkecil. */
const inlineCss = {
  name: "inline-css",
  setup(pluginBuild) {
    pluginBuild.onLoad({ filter: /\.css$/ }, async (args) => {
      const source = await readFile(args.path, "utf8");
      const { code } = await transform(source, { loader: "css", minify: true });
      return { contents: code, loader: "text" };
    });
  },
};

const options = {
  absWorkingDir: here,
  entryPoints: [join(here, "src", "widget.ts")],
  outfile: join(here, "dist", "widget.js"),
  bundle: true,
  format: "iife",
  target: "es2020",
  minify: !watch,
  plugins: [inlineCss],
  logLevel: "info",
};

if (watch) {
  const watcher = await context(options);
  await watcher.watch();
} else {
  await build(options);
}
