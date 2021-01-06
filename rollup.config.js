import path from "path";
import { spawn } from "child_process";
import { performance } from "perf_hooks";
import resolve from "@rollup/plugin-node-resolve";
import replace from "@rollup/plugin-replace";
import commonjs from "@rollup/plugin-commonjs";
import url from "@rollup/plugin-url";
import svelte from "rollup-plugin-svelte";
import babel from "@rollup/plugin-babel";
import { terser } from "rollup-plugin-terser";
import config from "sapper/config/rollup.js";
import colors from "kleur";

import pkg from "./package.json";

const { createPreprocessors } = require("./svelte.config.js");

const mode = process.env.NODE_ENV;
const dev = mode === "development";
const sourcemap = dev ? "inline" : false;
const legacy = !!process.env.SAPPER_LEGACY_BUILD;

const preprocess = createPreprocessors({ sourceMap: !!sourcemap });

// Changes in these files will trigger a rebuild of the global CSS
const globalCSSWatchFiles = ["postcss.config.js", "src/global.css"];

const onwarn = (warning, onwarn) =>
  (warning.code === "MISSING_EXPORT" && /'preload'/.test(warning.message)) ||
  (warning.code === "CIRCULAR_DEPENDENCY" &&
    /[/\\]@sapper[/\\]/.test(warning.message)) ||
  onwarn(warning);

export default {
  client: {
    input: config.client.input(),
    output: config.client.output(),
    plugins: [
      replace({
        "process.browser": true,
        "process.env.NODE_ENV": JSON.stringify(mode),
      }),
      svelte({
        compilerOptions: {
          dev,
          hydratable: true,
        },
        emitCss: true,
        preprocess,
      }),
      url({
        sourceDir: path.resolve(__dirname, "src/node_modules/images"),
        publicPath: "/client/",
      }),
      resolve({
        browser: true,
        dedupe: ["svelte"],
      }),
      commonjs(),

      legacy &&
        babel({
          extensions: [".js", ".mjs", ".html", ".svelte"],
          babelHelpers: "runtime",
          exclude: ["node_modules/@babel/**"],
          presets: [["@babel/preset-env", { targets: "> 0.25%, not dead" }]],
          plugins: [
            "@babel/plugin-syntax-dynamic-import",
            ["@babel/plugin-transform-runtime", { useESModules: true }],
          ],
        }),

      !dev && terser({ module: true }),

      (() => {
        let builder;
        let rebuildNeeded = false;

        const buildGlobalCSS = () => {
          if (builder) {
            rebuildNeeded = true;
            return;
          }
          rebuildNeeded = false;
          const start = performance.now();

          try {
            builder = spawn("node", [
              "--experimental-modules",
              "--unhandled-rejections=strict",
              "build-global-css.mjs",
              sourcemap,
            ]);
            builder.stdout.pipe(process.stdout);
            builder.stderr.pipe(process.stderr);

            builder.on("close", (code) => {
              if (code === 0) {
                const elapsed = parseInt(performance.now() - start, 10);
                console.log(
                  `${colors
                    .bold()
                    .green(
                      "✔ global css"
                    )} (src/global.pcss → static/global.css${
                    sourcemap === true ? " + static/global.css.map" : ""
                  }) ${colors.gray(`(${elapsed}ms)`)}`
                );
              } else if (code !== null) {
                if (dev) {
                  console.error(`global css builder exited with code ${code}`);
                  console.log(colors.bold().red("✗ global css"));
                } else {
                  throw new Error(
                    `global css builder exited with code ${code}`
                  );
                }
              }

              builder = undefined;

              if (rebuildNeeded) {
                console.log(
                  `\n${colors
                    .bold()
                    .italic()
                    .cyan("something")} changed. rebuilding...`
                );
                buildGlobalCSS();
              }
            });
          } catch (err) {
            console.log(colors.bold().red("✗ global css"));
            console.error(err);
          }
        };

        return {
          name: "build-global-css",
          buildStart() {
            buildGlobalCSS();
            globalCSSWatchFiles.forEach((file) => this.addWatchFile(file));
          },
          generateBundle: buildGlobalCSS,
        };
      })(),
    ],

    preserveEntrySignatures: false,
    onwarn,
  },

  server: {
    input: config.server.input(),
    output: config.server.output(),
    plugins: [
      replace({
        "process.browser": false,
        "process.env.NODE_ENV": JSON.stringify(mode),
      }),
      svelte({
        compilerOptions: {
          dev,
          generate: "ssr",
          hydratable: true,
        },
        emitCss: false,
        preprocess,
      }),
      url({
        sourceDir: path.resolve(__dirname, "src/node_modules/images"),
        publicPath: "/client/",
        emitFiles: false, // already emitted by client build
      }),
      resolve({
        dedupe: ["svelte"],
      }),
      commonjs(),
    ],
    external: Object.keys(pkg.dependencies).concat(
      require("module").builtinModules
    ),

    preserveEntrySignatures: "strict",
    onwarn,
  },

  // serviceworker: {
  // 	input: config.serviceworker.input(),
  // 	output: config.serviceworker.output(),
  // 	plugins: [
  // 		resolve(),
  // 		replace({
  // 			'process.browser': true,
  // 			'process.env.NODE_ENV': JSON.stringify(mode)
  // 		}),
  // 		commonjs(),
  // 		!dev && terser()
  // 	],

  // 	preserveEntrySignatures: false,
  // 	onwarn,
  // }
};
