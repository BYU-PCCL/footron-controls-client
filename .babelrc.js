// Based on https://github.com/tannerlinsley/react-query/blob/3d967bf8ae9404404d20824cc4ff263e6aa0f757/.babelrc.js
const { NODE_ENV, BABEL_ENV } = process.env;
const cjs = NODE_ENV === "test" || BABEL_ENV === "commonjs";
const loose = true;

module.exports = {
  presets: [
    [
      "@babel/env",
      {
        loose,
        modules: false,
        exclude: ["@babel/plugin-transform-regenerator"],
      },
    ],
    "@babel/preset-typescript",
    "@babel/react",
  ],
  plugins: [
    [
      "const-enum",
      {
        transform: "constObject",
      },
    ],
    "babel-plugin-transform-async-to-promises",
    cjs && ["@babel/transform-modules-commonjs", { loose }],
    // @vinhowe: Removed @babel/transform-runtime (see commment at top) because it was throwing an error and I'm
    //  not sure what it does for us. There may be a good reason to keep it.
  ].filter(Boolean),
};
