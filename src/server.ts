'use strict';

import * as path from 'path';
import * as postcss from 'postcss';
import * as micromatch from 'micromatch';
import * as moduleResolver from 'npm-module-path';

import {
	IConnection,
	TextDocuments,
	TextDocument,
	createConnection,
	IPCMessageReader,
	IPCMessageWriter,
	DiagnosticSeverity,
	Diagnostic,
	Files,
	ErrorMessageTracker,
	InitializeError,
	ResponseError

} from 'vscode-languageserver';

import ConfigResolver, {
	IConfig,
	IOptions

} from 'vscode-config-resolver';

const connection: IConnection = createConnection(
	new IPCMessageReader(process),
	new IPCMessageWriter(process)
);

const allDocuments: TextDocuments = new TextDocuments();

// "global" settings
let workspaceFolder: string;
let linter: any;
let editorSettings: any;

// "config"
let configResolver: ConfigResolver;
let needUpdateConfig = true;
let browsersListCache: string[] = [];

const doiuseNotFound: string = [
	'Failed to load doiuse library.',
	`Please install doiuse in your workspace folder using \'npm install doiuse\' or \'npm install -g doiuse\' and then press Retry.`

].join('');

function makeDiagnostic(problem: any): Diagnostic {
	const source = problem.usage.source;
	const message: string = problem.message.replace(/<input css \d+>:\d*:\d*:\s/, '');
	const level: string = editorSettings.messageLevel;

	const severityLevel = <any>{
		Error: DiagnosticSeverity.Error,
		Information: DiagnosticSeverity.Information,
		Warning: DiagnosticSeverity.Warning
	};

	return {
		severity: severityLevel[level],
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

function getErrorMessage(err: Error, document: TextDocument): string {
	const fsPath: string = Files.uriToFilePath(document.uri);
	let errorMessage = 'unknown error';

	if (typeof err.message === 'string' || <any>err.message instanceof String) {
		errorMessage = err.message;
	}

	return `vscode-doiuse: '${errorMessage}' while validating: ${fsPath} stacktrace: ${err.stack}`;
}

function getSyntax(language: string): any {
	switch (language) {
		case 'less':
			return require('postcss-less');
		case 'scss':
			return require('postcss-scss');
		case 'sass-indented':
		case 'sass':
		case 'stylus':
			return require('sugarss');
		default:
			return false;
	}
}

function browsersListParser(data: string): string[] {
	const lines = data.replace(/#.*(?:\n|\r\n)/g, '').split(/\r?\n/);

	const browsers: string[] = [];
	lines.forEach((line) => {
		if (line !== '') {
			browsers.push(line.trim());
		}
	});

	return browsers;
}

function getBrowsersList(documentFsPath: string): Promise<string[]> {
	const configResolverOptions: IOptions = {
		packageProp: 'browserslist',
		configFiles: [
			'browserslist'
		],
		editorSettings: editorSettings.browsers || null,
		parsers: [
			{ pattern: /.*list$/, parser: browsersListParser }
		]
	};

	if (!needUpdateConfig) {
		return Promise.resolve(browsersListCache);
	}

	return configResolver
		.scan(documentFsPath, configResolverOptions)
		.then((config: IConfig) => {
			browsersListCache = <string[]>config.json;
			needUpdateConfig = false;

			connection.console.info(`The following browser scope has been detected: ${browsersListCache.join(', ')}`);
			return browsersListCache;
		});
}

function validateDocument(document: TextDocument): any {
	const uri = document.uri;
	const content: string = document.getText();
	const diagnostics: Diagnostic[] = [];

	const lang: string = document.languageId;
	const syntax = getSyntax(lang);

	let fsPath: string = Files.uriToFilePath(uri);
	if (editorSettings.ignoreFiles.length) {
		if (workspaceFolder) {
			fsPath = path.relative(workspaceFolder, fsPath);
		}

		const match = micromatch([fsPath], editorSettings.ignoreFiles);
		if (editorSettings.ignoreFiles && match.length !== 0) {
			return diagnostics;
		}
	}

	return getBrowsersList(fsPath)
		.then((browsersList) => {
			const linterOptions = {
				browsers: browsersList,
				ignore: editorSettings.ignore,
				onFeatureUsage: (usageInfo: any) => diagnostics.push(makeDiagnostic(usageInfo))
			};

			postcss(linter(linterOptions))
				.process(content, syntax && { syntax })
				.then(() => {
					connection.sendDiagnostics({ diagnostics, uri });
				})
				.catch((err: Error) => {
					connection.console.error(err.toString());
				});
		});
}

function validate(documents: TextDocument[]): void {
	const tracker = new ErrorMessageTracker();

	Promise
		.all(
			documents.map((document) =>
				validateDocument(document)
					.catch((err: Error) => {
						tracker.add(getErrorMessage(err, document));
					})
			)
		)
		.then(() => {
			tracker.sendErrors(connection);
		});
}

connection.onInitialize((params) => {
	workspaceFolder = params.rootPath;

	configResolver = new ConfigResolver(workspaceFolder);

	return moduleResolver
		.resolveOne('doiuse', workspaceFolder)
		.then((modulePath) => {
			if (modulePath === undefined) {
				throw {
					message: 'Module not found.',
					code: 'ENOENT'
				};
			}

			linter = require(modulePath);

			return {
				capabilities: {
					textDocumentSync: allDocuments.syncKind
				}
			};
		})
		.catch((err: Error) => {
			// If the error is not caused by a lack of module
			if ((<any>err).code !== 'ENOENT') {
				connection.console.error(err.toString());
				return null;
			}

			if (params.initializationOptions && Object.keys(params.initializationOptions).length !== 0) {
				return Promise.reject(new ResponseError<InitializeError>(99, doiuseNotFound, { retry: true }));
			}

			return null;
		});
});

connection.onDidChangeConfiguration((params) => {
	editorSettings = params.settings.doiuse;

	validate(allDocuments.all());
});

connection.onDidChangeWatchedFiles(() => {
	needUpdateConfig = true;

	validate(allDocuments.all());
});

// The documents manager listen for text document create,
// change and close on the connection
allDocuments.listen(connection);

// A text document has changed. Validate the document.
allDocuments.onDidChangeContent((event) => {
	if (editorSettings.run === 'onType') {
		validate([event.document]);
	}
});

allDocuments.onDidSave((event) => {
	if (editorSettings.run === 'onSave') {
		validate([event.document]);
	}
});

allDocuments.onDidClose((event) => {
	connection.sendDiagnostics({
		uri: event.document.uri,
		diagnostics: []
	});
});

connection.listen();
