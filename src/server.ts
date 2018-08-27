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

interface IWorkspaceSettings {
	browsers: string[];
	ignore: string[];
	ignoreFiles: string[];
	messageLevel: string;
	run: string;
}

type IBrowsersList = string[];
type IBrowsersListStore = Record<string, IBrowsersList>;

interface IProblem {
	feature: number;
	featureData: Object;
	usage: {
		source: any
	};
	message: string;
}

const connection: IConnection = createConnection(
	new IPCMessageReader(process),
	new IPCMessageWriter(process)
);

const allDocuments: TextDocuments = new TextDocuments();

// "global" settings
let workspaceFolder: string;
let workspaceSettings: IWorkspaceSettings;
let linter: (options: any) => any;

// "config"
let configResolver: ConfigResolver;
let browsersListStore: IBrowsersListStore = {};

const severityLevel = <any>{
	Error: DiagnosticSeverity.Error,
	Information: DiagnosticSeverity.Information,
	Warning: DiagnosticSeverity.Warning
};

const doiuseNotFound: string = [
	'Failed to load doiuse library.',
	`Please install doiuse in your workspace folder using \'npm install doiuse\' or \'npm install -g doiuse\' and then press Retry.`

].join('');

function emptyBrowsersListStore(): void {
	browsersListStore = {};
}

function getSeverity(problem: IProblem): DiagnosticSeverity {
	if (problem.featureData.hasOwnProperty('missing')) {
		return severityLevel.Error;
	}

	if (problem.featureData.hasOwnProperty('partial')) {
		return severityLevel.Warning;
	}

	return severityLevel.Information;
}

function makeDiagnostic(problem: IProblem): Diagnostic {
	const source = problem.usage.source;
	const message: string = problem.message.replace(/<input css \d+>:\d*:\d*:\s/, '');

	return {
		severity: getSeverity(problem),
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
	let errorMessage: string = 'unknown error';

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

function browsersListParser(data: string): IBrowsersList {
	return data
		.replace(/#.*(?:\n|\r\n)/g, '')
		.split(/\r?\n/)
		.filter((line: string) => line !== '')
		.map((line: string) => line.trim());
}

function getParentFolder(document: string): string {
	return path
		.relative(workspaceFolder, document)
		.replace(/[^(/|\\)]*$/g, '');
}

function getBrowsersList(document: string): Promise<IBrowsersList> {
	if (browsersListStore[document]) {
		return Promise.resolve(browsersListStore[document]);
	}

	const configResolverOptions: IOptions = {
		packageProp: 'browserslist',
		configFiles: [
			'.browserslistrc',
			'browserslist'
		],
		editorSettings: workspaceSettings.browsers || null,
		parsers: [
			{
				pattern: /\.?browserslist(rc)?$/,
				parser: browsersListParser
			}
		]
	};

	return configResolver
		.scan(document, configResolverOptions)
		.then((config: IConfig) => {
			if (!config) {
				return undefined;
			}

			const parentFolder: string = getParentFolder(document);

			const currentScope: string = 'The browser scope for files under ' +
				parentFolder + ' is "' + (<IBrowsersList>config.json).join(', ') + '"';

			if (!browsersListStore.hasOwnProperty(parentFolder)) {
				connection.console.info(currentScope);
				browsersListStore[parentFolder] = <IBrowsersList>config.json;
			}

			return browsersListStore[parentFolder];
		})
		.catch(() => undefined);
}

function validateDocument(document: TextDocument): Promise<any> {
	const uri: string = document.uri;
	const content: string = document.getText();
	const diagnostics: Diagnostic[] = [];

	const getDiagnostics = (): Diagnostic[] => {
		return diagnostics.filter((diagnostic: Diagnostic) =>
			diagnostic.severity <= severityLevel[workspaceSettings.messageLevel]
		);
	};

	const lang: string = document.languageId;
	const syntax = getSyntax(lang);

	let fsPath: string = Files.uriToFilePath(uri);
	if (workspaceSettings.ignoreFiles.length) {
		if (workspaceFolder) {
			fsPath = path.relative(workspaceFolder, fsPath);
		}

		const match = micromatch([fsPath], workspaceSettings.ignoreFiles);
		if (workspaceSettings.ignoreFiles && match.length !== 0) {
			return Promise.resolve(getDiagnostics());
		}
	}

	return getBrowsersList(fsPath)
		.then((browsersList) => {
			if (!browsersList) {
				return undefined;
			}

			const linterOptions = {
				browsers: browsersList,
				ignore: workspaceSettings.ignore,
				onFeatureUsage: (usageInfo: any) =>
					diagnostics.push(makeDiagnostic(usageInfo))
			};

			postcss(linter(linterOptions))
				.process(content, syntax && { syntax })
				.then(() => {
					connection.sendDiagnostics({
						diagnostics: getDiagnostics(),
						uri
					});
				})
				// Ignore syntax errors
				.catch(() => {});
		});
}

function validate(documents: TextDocument[]): void {
	const tracker = new ErrorMessageTracker();

	Promise
		.all(documents.map((document) =>
			validateDocument(document)
				.catch((err: Error) => {
					tracker.add(getErrorMessage(err, document));
				})
		))
		.then(() => {
			tracker.sendErrors(connection);
		});
}

connection.onInitialize((params): Promise<any> => {
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

connection.onDidChangeConfiguration((params): void => {
	workspaceSettings = params.settings.doiuse;
	emptyBrowsersListStore();

	validate(allDocuments.all());
});

connection.onDidChangeWatchedFiles((): void => {
	emptyBrowsersListStore();

	validate(allDocuments.all());
});

allDocuments.listen(connection);

allDocuments.onDidChangeContent((event): void => {
	if (workspaceSettings.run === 'onType') {
		validate([event.document]);
	}
});

allDocuments.onDidSave((event): void => {
	if (workspaceSettings.run === 'onSave') {
		validate([event.document]);
	}
});

allDocuments.onDidClose((event): void => {
	connection.sendDiagnostics({
		uri: event.document.uri,
		diagnostics: []
	});
});

connection.listen();
