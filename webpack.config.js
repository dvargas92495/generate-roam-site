const path = require("path");
const TerserPlugin = require("terser-webpack-plugin");
const webpack = require('webpack');

module.exports = () => ({
  mode: "production",
  entry: {
    header: "./src/Header.tsx",
    sidebar: "./src/Sidebar.tsx",
  },
  resolve: {
    modules: ["node_modules"],
    extensions: [".ts", ".js", ".tsx"],
  },
  output: {
    path: path.join(__dirname, "build"),
    filename: "[name].js",
  },
  module: {
    rules: [
      {
        test: /\.tsx?$/,
        use: [
          {
            loader: "babel-loader",
            options: {
              cacheDirectory: true,
              cacheCompression: false,
            },
          },
          {
            loader: "ts-loader",
            options: {
              compilerOptions: {
                noEmit: false,
              },
            },
          },
        ],
        exclude: /node_modules/,
      },
      {
        test: /\.css$/i,
        use: ["style-loader", "css-loader"],
      },
      {
        test: /\.(png|jpe?g|gif)$/i,
        use: [
          {
            loader: "file-loader",
          },
        ],
      },
      {
        test: /\.(svg)$/,
        loader: "svg-react-loader",
      },
      {
        test: /\.(woff|woff2|eot|ttf)$/,
        loader: "url-loader",
        options: {
          limit: 100000,
        },
      },
    ],
  },
  performance: {
    hints: "error",
    maxEntrypointSize: 5000000,
    maxAssetSize: 5000000,
  },
  optimization: {
    minimizer: [
      new TerserPlugin({
        extractComments: false,
      }),
    ],
  },
  plugins: [
    new webpack.DefinePlugin({
      "process.env.CLIENT_SIDE": "true",
    }),
  ],
});
