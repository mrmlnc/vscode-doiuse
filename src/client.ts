'use strict';

import * as path from 'path';

import {
	ExtensionContext,
	workspace

} from 'vscode';

import {
	TransportKind,
	LanguageClient,
	SettingMonitor,
	LanguageClientOptions,
	ServerOptions

} from 'vscode-languageclient';

export function activate(context: ExtensionContext) {
	const serverModule = path.join(__dirname, 'server.js');

	const clientOptions: LanguageClientOptions = {
		documentSelector: ['css', 'less', 'stylus', 'scss', 'sass', 'sass-indented'],
		synchronize: {
			configurationSection: 'doiuse',
			fileEvents: [
				workspace.createFileSystemWatcher('**/package.json'),
				workspace.createFileSystemWatcher('**/.browserslistrc'),
				workspace.createFileSystemWatcher('**/browserslist')
			]
		},
		diagnosticCollectionName: 'doiuse',
		initializationOptions: workspace.getConfiguration('doiuse')
	};

	const serverOptions: ServerOptions = {
		run: {
			module: serverModule,
			transport: TransportKind.ipc
		},
		debug: {
			module: serverModule,
			transport: TransportKind.ipc,
			options: {
				execArgv: ['--nolazy', '--debug=6004']
			}
		}
	};

	const client = new LanguageClient(
		'doiuse',
		'doiuse language server',
		serverOptions,
		clientOptions
	);

	// Go to the world
	context.subscriptions.push(
		new SettingMonitor(client, 'doiuse.enable').start()
	);
}
