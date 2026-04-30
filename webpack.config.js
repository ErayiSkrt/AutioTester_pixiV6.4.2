const path = require('path');
const HtmlWebpackPlugin = require('html-webpack-plugin');

module.exports = (_env, argv) => {
  const isProd = argv && argv.mode === 'production';

  return {
    mode: isProd ? 'production' : 'development',
    entry: './src/index.ts',
    output: {
      path: path.resolve(__dirname, 'dist'),
      filename: 'bundle.[contenthash].js',
      clean: true,
    },
    resolve: {
      extensions: ['.ts', '.js'],
    },
    module: {
      rules: [
        {
          test: /\.ts$/,
          loader: 'ts-loader',
          exclude: /node_modules/,
        },
        {
          test: /\.css$/,
          use: ['style-loader', 'css-loader'],
        },
      ],
    },
    plugins: [
      new HtmlWebpackPlugin({
        template: './src/index.html',
        title: 'Audio Tester (pixi-sound)',
      }),
    ],
    devServer: {
      static: path.resolve(__dirname, 'dist'),
      port: 9000,
      open: true,
      hot: true,
      host: '0.0.0.0',
      allowedHosts: 'all',
    },
    devtool: isProd ? false : 'source-map',
    performance: {
      hints: false,
    },
  };
};
