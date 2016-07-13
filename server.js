'use strict';

const path = require('path');

const {
  createConnection,
  IPCMessageReader,
  IPCMessageWriter,
  TextDocuments,
  DiagnosticSeverity,
  ErrorMessageTracker,
  Files,
  ResponseError
} = require('vscode-languageserver');

const connection = createConnection(new IPCMessageReader(process), new IPCMessageWriter(process));
const documents = new TextDocuments();

const multimatch = require('multimatch');
const postcss = require('postcss');

let rootFolder = '';
let linter = null;
let settings = {};

const notFoundMessage = `Failed to load doiuse library. Please install doiuse in your workspace folder using \'npm install doiuse\' or \'npm install -g doiuse\' and then press Retry.`;

function makeDiagnostic(problem) {
  const source = problem.usage.source;
  const message = problem.message.replace(/<input css \d+>:\d*:\d*:\s/, '');

  return {
    severity: DiagnosticSeverity[settings.messageLevel],
    message,
    range: {
      start: {
        line: source.start.line - 1,
        character: source.start.column - 1
      },
      end: {
        line: source.end.line - 1,
        character: source.end.column
      }
    },
    code: problem.feature,
    source: 'doiuse'
  };
}

function getErrorMessage(err, document) {
  let errorMessage = `unknown error`;
  if (typeof err.message === 'string' || err.message instanceof String) {
    errorMessage = err.message;
  }

  const fsPath = Files.uriToFilePath(document.uri);

  return `vscode-doiuse: '${errorMessage}' while validating: ${fsPath} stacktrace: ${err.stack}`;
}

function validateAllTextDocuments(documents) {
  const tracker = new ErrorMessageTracker();
  documents.forEach((document) => {
    try {
      validateTextDocument(document);
    } catch (err) {
      tracker.add(getErrorMessage(err, document));
    }
  });
  tracker.sendErrors(connection);
}

function validateTextDocument(document) {
  try {
    doValidate(document);
  } catch (err) {
    connection.window.showErrorMessage(getErrorMessage(err, document));
  }
}

function getSyntax(language) {
  switch (language) {
    case 'less': {
      return require('postcss-less');
    }
    case 'scss': {
      return require('postcss-scss');
    }
    case 'sass-indented':
    case 'sass':
    case 'stylus': {
      return require('sugarss');
    }
    default: {
      return false;
    }
  }
}

function doValidate(document) {
  const uri = document.uri;
  const content = document.getText();
  const diagnostics = [];

  const lang = document.languageId || document._languageId;
  const syntax = getSyntax(lang);

  if (settings.ignoreFiles.length) {
    let fsPath = Files.uriToFilePath(uri);
    if (rootFolder) {
      fsPath = path.relative(rootFolder, fsPath);
    }

    const match = multimatch([fsPath], settings.ignoreFiles);
    if (settings.ignoreFiles && match.length !== 0) {
      return diagnostics;
    }
  }

  const linterOptions = {
    browsers: settings.browsers,
    ignore: settings.ignore,
    onFeatureUsage: (usageInfo) => diagnostics.push(makeDiagnostic(usageInfo))
  };

  postcss(linter(linterOptions))
    .process(content, syntax && { syntax })
    .then(() => {
      connection.sendDiagnostics({ diagnostics, uri });
    });
}

connection.onInitialize((params) => {
  rootFolder = params.rootPath;
  return Files.resolveModule(rootFolder, 'doiuse')
    .then((value) => {
      linter = value;

      return {
        capabilities: {
          textDocumentSync: documents.syncKind
        }
      };
    })
    .catch(() => {
      return Promise.reject(new ResponseError(99, notFoundMessage, { retry: true }));
    });
});

connection.onDidChangeConfiguration((params) => {
  settings = params.settings.doiuse;

  validateAllTextDocuments(documents.all());
});

documents.onDidChangeContent((event) => {
  if (settings) {
    validateTextDocument(event.document);
  }
});

documents.onDidClose((event) => connection.sendDiagnostics({ uri: event.document.uri, diagnostics: [] }));

documents.listen(connection);
connection.listen();
