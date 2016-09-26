'use strict';

const path = require('path');

const {
	TransportKind,
	LanguageClient,
	SettingMonitor
} = require('vscode-languageclient');

function activate(context) {
	const serverModule = path.join(__dirname, 'server.js');

	const clientOptions = {
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

	const serverOptions = {
		documentSelector: ['css', 'less', 'stylus', 'scss', 'sass', 'sass-indented'],
		synchronize: {
			configurationSection: 'doiuse'
		},
		diagnosticCollectionName: 'doiuse'
	};

	const client = new LanguageClient('doiuse', clientOptions, serverOptions);

	context.subscriptions.push(new SettingMonitor(client, 'doiuse.enable').start());
}

exports.activate = activate;
