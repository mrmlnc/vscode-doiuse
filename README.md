# VS Code plugin for doiuse

> This linter plugin for VS Code provides an interface to [doiuse](https://github.com/anandthakker/doiuse)

![doiuse](https://cloud.githubusercontent.com/assets/7034281/16776880/0282e982-4870-11e6-811f-a2a65cbc4eb7.png)

## Install

Linter installation is performed in several stages:

  1. Install **doiuse** use `npm i -D doiuse` or `npm i -g doiuse`.
  2. Press `F1` and select `Extensions: Install Extensions`.
  3. Search and choose `vscode-doiuse`.

See the [extension installation guide](https://code.visualstudio.com/docs/editor/extension-gallery) for details.

## Usage

Enable the linter in the VS Code [settings](https://code.visualstudio.com/docs/customization/userandworkspace).

```json
{
  "doiuse.enable": true
}
```

## Supported languages

  * CSS
  * Less (experimental support)
  * SCSS
  * Sass (experimental and by [sass-indented](https://marketplace.visualstudio.com/items?itemName=robinbentley.sass-indented))
  * Stylus (experimental, only indent-based CSS syntax and by [extensions](https://marketplace.visualstudio.com/search?term=stylu&target=VSCode&sortBy=Relevance))

## Supported settings

**doiuse.enable**

Type: `Boolean`</br>
Default: `false`

Control whether doiuse is enabled for styles files or not.

**doiuse.messageLevel**

Type: `String`</br>
Default: `Warning`</br>
Available values: `"Information", "Warning", "Error"`

Represents a diagnostic level, such as a Information, Warning or Error.

**doiuse.browsers**

Type: `Array`</br>
Default: `[]`</br>
Example: `["ie >= 9"]`

An autoprefixer-like array of browsers. See the [official repository](https://github.com/anandthakker/doiuse) for details.

**doiuse.ignore**

Type: `Array`</br>
Default: `[]`</br>
Example: `["rem"]`

An optional array of features to ignore. See the [official repository](https://github.com/anandthakker/doiuse) for details.

**doiuse.ignoreFiles**

Type: `Array`</br>
Default: `[]`</br>
Example: `["**/*.css"]`

An optional array of file globs to match against original source file path, to ignore. See the [official repository](https://github.com/anandthakker/doiuse) for details.

## Changelog

See the [Releases section of our GitHub project](https://github.com/mrmlnc/vscode-doiuse/releases) for changelogs for each release version.

## License

This software is released under the terms of the MIT license.
