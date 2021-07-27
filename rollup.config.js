// Based on https://github.com/tannerlinsley/react-query/blob/7a628d6497e6f71242f9af84de46997083f12549/rollup.config.js
import babel from "rollup-plugin-babel";
import { terser } from "rollup-plugin-terser";
import size from "rollup-plugin-size";
import externalDeps from "rollup-plugin-peer-deps-external";
import resolve from "rollup-plugin-node-resolve";
import commonJS from "rollup-plugin-commonjs";
import replace from "@rollup/plugin-replace";

const external = ["react", "react-dom"];

const globals = {
  react: "React",
  "react-dom": "ReactDOM",
};

// TODO: Determine if we need this whole list and map solution--will we ever add more entries here?
//  The answer is probably yes--see comment in src/react/useMessaging.ts
const inputSrcs = [["src/index.ts", "FootronControls", "controls-client"]];

const extensions = [".js", ".jsx", ".es6", ".es", ".mjs", ".ts", ".tsx"];
const babelConfig = { extensions, runtimeHelpers: true };
const resolveConfig = { extensions };

export default inputSrcs
  .map(([input, name, file]) => {
    return [
      {
        input: input,
        output: {
          name,
          file: `dist/${file}.development.js`,
          format: "umd",
          sourcemap: true,
          globals,
        },
        external,
        plugins: [
          resolve(resolveConfig),
          babel(babelConfig),
          commonJS(),
          externalDeps(),
        ],
      },
      {
        input: input,
        output: {
          name,
          file: `dist/${file}.production.min.js`,
          format: "umd",
          sourcemap: true,
          globals,
        },
        external,
        plugins: [
          replace({
            "process.env.NODE_ENV": `"production"`,
            delimiters: ["", ""],
            preventAssignment: true,
          }),
          resolve(resolveConfig),
          babel(babelConfig),
          commonJS(),
          externalDeps(),
          terser(),
          size(),
        ],
      },
    ];
  })
  .flat();
