const path = require('path');
const Dotenv = require('dotenv-webpack');

const DOT_ENV_FILE = path.resolve(__dirname, '.env');

module.exports = {
  mode: 'development',
  module: {
    rules: [
      {
        test: /\.js$/,
        loader: 'string-replace-loader',
        options: {
          search: '__SDK__',
          replace: process.env.SDK,
        }
      },
      {
        test: /\.js$/,
        exclude: /(node_modules)/,
        use: {
          loader: 'babel-loader'
        }
      }
    ]
  },
  plugins: [
    new Dotenv({
      path: DOT_ENV_FILE
    })
  ]
};