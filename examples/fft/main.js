// const electron = require('electron')
// // Module to control application life.
// const app = electron.app
// // Module to create native browser window.
// const BrowserWindow = electron.BrowserWindow

// const path = require('path')
// const url = require('url')
// require("babel-register");
const electron = require('electron'), { app } = electron; // Module to control application life.
const BrowserWindow = electron.BrowserWindow; // Module to create native browser window.
const path = require('path'), { join: joinPath } = path;
const url = require('url');
const escapeFlags = (...values) => [].concat(...values).join(' ').split(/[^\w\-\_]+/).map(flag => `${flag}`.replace(/^-*/, '--').replace(/(\S)(\s+|[\b[^\-\_]])(?=\w)/g, '$1-'));
const escapeSwitches = (switches) => Object.entries(switches).reduce((switches, [key, value]) => (switches[escapeFlags(key)] = value, switches), {});// ([key, value], ...switches) => ({ ...(key ? { [escapeFlags(key)]: value } : {}), ...(switches.length ? { escapeSwitches(...switches) } : {}) });
const settings = {
    mainWindow: {
        maximize: true, // devtools: true,
        options: {
            width: 800, height: 600,
            vibrancy: 'ultra-dark', // darkTheme: true, // titleBarStyle: 'transparent', // backgroundColor: 'transparent',
            // transparent: true,
            acceptFirstMouse: true, disableAutoHideCursor: true,
            webPreferences: {
                backgroundThrottling: false,
                allowRunningInsecureContent: true,
                // nodeIntegration: true,
                // nodeIntegrationInWorker: true,
                contextIsolation: true,
                sandbox: true,
                enableBlinkFeatures: 'SharedArrayBuffer,Accelerated2dCanvas,CSSBackdropFilter,CSSHexAlphaColor,ExperimentalV8Extras,StableBlinkFeatures', // ,CSSVariables,CustomElementsBuiltin
                experimentalCanvasFeatures: true, experimentalFeatures: true,
                /** @see https://electron.atom.io/docs/tutorial/offscreen-rendering/ */
                // offscreen: false,
            },
            show: false,
        },
        autoShow: true,
        loadURL: { protocol: 'file:', slashes: true, pathname: joinPath(__dirname, 'index.html') },
    },
    /** @see https://peter.sh/experiments/chromium-command-line-switches/ */
    arguments: [
        // 'disable-renderer-backgrounding', // Prevent renderer process backgrounding when set.
        // 'disable-gpu-driver-bug-workarounds', // Disable workarounds for various GPU driver bugs.
        'enable-experimental-canvas-features', // Enable experimental canvas features, e.g. canvas 2D context attributes.
        'enable-experimental-web-platform-features', // Enables Web Platform features that are in development.
        // 'enable-gpu-async-worker-context', // Makes the GL worker context run asynchronously by using a separate stream.
        // 'enable-gpu-client-logging', // Enable GPU client logging.
        'enable-native-gpu-memory-buffers', // Enable native GPU memory buffer support when available.
        'enable-zero-copy', // Enable rasterizer that writes directly to GPU memory associated with tiles.
        // 'show-fps-counter', // Draws a heads-up-display showing Frames Per Second as well as GPU memory usage. If you also use --enable-logging=stderr --vmodule="head*=1" then FPS will also be output to the console log.
    ],
    switches: {
        'num-raster-threads': 8,
        'js-flags': escapeFlags([
            'harmony_sharedarraybuffer',
            'turbo',
            'ignition',
            'experimental_extras',
            'fast_math'
        ]).join(' '),
    }
};

/** @see https://electron.atom.io/docs/api/sandbox-option/ */
// app.commandLine.appendSwitch('enable-sandbox'); // Cannot --enable-sanbox here, must pass to electron CLI
// const appendArguments = (...args) => args.forEach(arg => app.commandLine.appendArgument(arg));
// const appendSwitches = ([key, value], ...switches) => (key && app.commandLine.appendSwitch(key, value), switches.length && appendSwitches(...switches)); // args.forEach(arg => app.commandLine.appendSwitch(... arg));
const arguments = escapeFlags(...settings.arguments || []);
const switches = escapeSwitches(settings.switches || {}); // [...settings.arguments || []];
arguments.forEach(arg => app.commandLine.appendArgument(arg));
Object.entries(switches).forEach(args => app.commandLine.appendSwitch(...args));
console.log({ arguments, switches });
// [...settings.arguments || []].forEach(argument => app.commandLine.appendArgument(argument));
// Object.entries(settings.switches || {}).forEach(([key, value]) => app.commandLine.appendSwitch(escapeFlags(key), value));
// [...settings.arguments || []].forEach(argument => app.commandLine.appendArgument(`--${argument}`.replace(/^----/, '--')));
// app.commandLine.appendArgument('', '--disable-gpu-driver-bug-workarounds');
// app.commandLine.appendSwitch('js-flags', '--harmony  --harmony-sharedarraybuffer --turbo --experimental_extras --ignition --fast_math'); //  --expose_natives_as="natives"

let mainWindow; // Keep a global reference of the window object, if you don't, the window will be closed automatically when the JavaScript object is garbage collected.

function createWindow(event, _, { maximize, devtools, options = {}, loadURL, autoShow = options.show === false } = settings.mainWindow || {}) {
    // console.log('createWindow', arguments);
    mainWindow = new BrowserWindow(options); // Create the browser window.
    maximize && mainWindow.maximize();
    loadURL && mainWindow.loadURL(url.format(loadURL)); // and load the index.html of the app.
    devtools && mainWindow.webContents.openDevTools() // Open the DevTools.
    mainWindow.on('closed', () => mainWindow = null); // Dereference the window object, usually you would store windows in an array if your app supports multi windows, this is the time when you should delete the corresponding element.
    autoShow && mainWindow.on('ready-to-show', () => (mainWindow.show(), mainWindow.focus()));
    // // Open the DevTools.
    // // mainWindow.webContents.openDevTools()

    // // Emitted when the window is closed.
    // mainWindow.on('closed', function () {
    //     // Dereference the window object, usually you would store windows
    //     // in an array if your app supports multi windows, this is the time
    //     // when you should delete the corresponding element.
    //     mainWindow = null
    // })
}

app.on('ready', createWindow) // This method will be called when Electron has finished initialization and is ready to create browser windows. Some APIs can only be used after this event occurs.
app.on('activate', () => mainWindow || createWindow()); // On OS X it's common to re-create a window in the app when the dock icon is clicked and there are no other windows open.
app.on('window-all-closed', () => process.platform === 'darwin' || app.quit()); // Quit when all windows are closed. // On OS X it is common for applications and their menu bar to stay active until the user quits explicitly with Cmd + Q


// // This method will be called when Electron has finished
// // initialization and is ready to create browser windows.
// // Some APIs can only be used after this event occurs.
// app.on('ready', createWindow)

// // Quit when all windows are closed.
// app.on('window-all-closed', function () {
//     // On OS X it is common for applications and their menu bar
//     // to stay active until the user quits explicitly with Cmd + Q
//     if (process.platform !== 'darwin') {
//         app.quit()
//     }
// })

// app.on('activate', function () {
//     // On OS X it's common to re-create a window in the app when the
//     // dock icon is clicked and there are no other windows open.
//     if (mainWindow === null) {
//         createWindow()
//     }
// })

// // In this file you can include the rest of your app's specific main process
// // code. You can also put them in separate files and require them here.

// // 'use strict';

// // const electron = require('electron');
// // const app = electron.app;  // Module to control application life.
// // const BrowserWindow = electron.BrowserWindow;  // Module to create native browser window.
// // var mainWindow = null;

// // app.on('window-all-closed', function () {
// //     if (process.platform != 'darwin') {
// //         app.quit();
// //     }
// // });

// // app.on('ready', function () {
// //     mainWindow = new BrowserWindow({ width: 800, height: 600 });
// //     mainWindow.loadURL('file://' + __dirname + '/index.html');

// //     mainWindow.on('closed', function () {
// //         mainWindow = null;
// //     });
// // });
