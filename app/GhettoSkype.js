const electron = require('electron');
const fs       = require('fs');
const path     = require('path');
const spawn    = require('child_process').spawn;
const tmp      = require('tmp');
const mime     = require('mime');
const stylus   = require('stylus');

const settings = require('../settings');

const BrowserWindow = electron.BrowserWindow;

let settingsFile = path.join(electron.app.getPath('userData'), 'settings.json');
try {
	let tmpSettings = JSON.parse(fs.readFileSync(settingsFile));
	Object.assign(settings, tmpSettings);
} catch(e){}

class GhettoSkype {
	constructor(settings) {
		this.settings   = settings;
		this.windows    = [];
		this.imageCache = {};

		const ipc = electron.ipcMain;

		ipc.on('image:download', this.downloadImage.bind(this));
		ipc.on('settings:save', this.saveSettings.bind(this));
		ipc.on('settings:get', (event) => event.returnValue = settings);
	}

	createWindow(options) {
		let window = new BrowserWindow(options);
		let index  = this.windows.push(window) - 1;

		window.on('closed', () => this.windows.splice(index, 1));

		return window;
	}

	downloadImage(event, url) {
		let file = this.imageCache[url];
		if (file) {
			if (file.complete) {
				spawn('xdg-open', [file.path]);
			}

			// Pending downloads intentionally do not proceed
			return;
		}

		let tmpWindow = new BrowserWindow({
			show: false,
			webPreferences: {
				partition: 'persist:skype'
			}
		});

		if (this.settings.ProxyRules) {
			tmpWindow.webContents.session.setProxy({
				proxyRules: this.settings.ProxyRules
			}, () => {});
		}

		tmpWindow.webContents.session.once('will-download', (event, downloadItem) => {
			this.imageCache[url] = file = {
				path: tmp.tmpNameSync() + '.' + mime.extension(downloadItem.getMimeType()),
				complete: false
			};

			downloadItem.setSavePath(file.path);
			downloadItem.once('done', () => {
				tmpWindow.destroy();
				tmpWindow = null;

				spawn('xdg-open', [file.path]);

				file.complete = true;
			});
		});

		tmpWindow.webContents.downloadURL(url);
	}

	openSettings() {
		if (this.settingsWindow) {
			this.settingsWindow.show();
			return;
		}

		this.settingsWindow = this.createWindow({
			autoHideMenuBar: true,
			center: true,
			width: 800,
			height: 400,
			webPreferences: {
				zoomFactor: this.settings.ZoomFactor
			}
		});

		if (this.settings.Theme) {
			let folder = path.join(__dirname, '..', 'themes', this.settings.Theme);
			let p = path.join(folder, 'settings.styl');
			fs.readFile(p, 'utf8', (err, scss) => {
				stylus(scss)
					.include(folder)
					.render((err, css) => {
						this.settingsWindow.webContents.once('did-finish-load', () => this.settingsWindow.webContents.insertCSS(css));
					});
			});
		}

		this.settingsWindow.on('closed', () => delete this.settingsWindow);

		let filePath = path.join(__dirname, '..', 'views', 'settings.html');
		this.settingsWindow.loadURL("file://" + filePath);
	}

	saveSettings(event, settings) {
		Object.assign(this.settings, settings);
		this.sendToRenderers('settings:updated', this.settings);

		let data = JSON.stringify(this.settings, null, "\t");
		fs.writeFile(settingsFile, data, (err) => {
			if (err) throw err;

			if (this.settingsWindow) {
				this.settingsWindow.destroy();
				this.settingsWindow = null;
			}
		});
	}

	sendToRenderers(channel, args) {
		this.windows.forEach(window => {
			let webContents = window.webContents;
			webContents.send.apply(webContents, arguments);
		});
	}
}

module.exports = new GhettoSkype(settings);
