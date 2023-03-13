const {
  app,
  BrowserWindow,
  nativeImage,
  ipcMain,
  Tray,
  Menu,
  safeStorage,
  shell,
  powerMonitor,
} = require("electron");
const path = require("path");
const Positioner = require("electron-positioner");
try {
  require("electron-reloader")(module);
} catch (_) {}
const AxiosManager = require("./utils/axios.utils");
const Helpers = require("./utils/helpers.utils");
const PowerShell = require("./utils/powershell.utils");
const CheckForUpdates = require("./utils/checkForUpdates.utils");
const Store = require("electron-store");
const dayjs = require("dayjs");
const nodeMachineId = require("node-machine-id");
const store = new Store();
const icon = nativeImage.createFromPath(
  path.join(__dirname, "assets", "logo.ico")
);
const { decrypt } = require("./utils/crypto.utils");
const { disconnectPowershell } = require("./utils/powershell.utils");
app.setAppUserModelId("Spectre VPN");
let mainWindow;
let tray;

function loadPage(redirectTo) {
  const routes = {
    LOGIN: () => {
      mainWindow.loadFile(path.join(__dirname, "pages", "login", "login.html"));
      mainWindow.height = 595;
      mainWindow.setSkipTaskbar(true);
    },
    HOME: () => {
      mainWindow.loadFile(path.join(__dirname, "pages", "home", "home.html"));
      mainWindow.height = 595;
      mainWindow.setSkipTaskbar(true);
    },
    SPLASH: () => {
      mainWindow.loadFile(
        path.join(__dirname, "pages", "splash", "splash.html")
      );
      // mainWindow.setSkipTaskbar(true);
    },
  };

  routes[redirectTo]();
}

function createWindow() {
  mainWindow = new BrowserWindow({
    //app details
    title: "Spectre VPN",
    icon,

    //app aspects
    width: 400,
    height: 400,
    movable: true,
    resizable: false,
    minWidth: 400,
    minHeight: 595,
    maxHeight: 595,
    maxWidth: 400,
    //app settings
    frame: false,
    minimizable: false,
    maximizable: false,
    focusable: true,
    closable: false,
    // alwaysOnTop: true,
    fullscreen: false,
    fullscreenable: false,
    skipTaskbar: false,
    webPreferences: {
      devTools: false,
      preload: path.join(__dirname, "preload.js"),
      spellcheck: false,
    },
  });
}

app.on("ready", async function () {
  const response = await CheckForUpdates.checkForUpdates(app.getVersion());
  createWindow();
  loadPage("SPLASH");

  const positioner = new Positioner(mainWindow);
  positioner.move("center");

  

  const userCredentials = store.get("credentials");

  if (userCredentials) {
    try {
      const response = await AxiosManager.requestPrivate(
        "GET",
        "/v1/user/me",
        {},
        safeStorage.decryptString(Buffer.from(userCredentials.token, "hex"))
      );

      store.set("credentials", {
        token: userCredentials.token,
        _id: safeStorage.encryptString(response.data._id).toString("hex"),
        username: response.data.username,
        expiryDate: response.data.expiryDate,
        connection: response.data.connection,
      });

      const { expiryDate } = response.data;
      const daysDiff = dayjs(expiryDate).diff(
        dayjs().add(2, "hours").toDate(),
        "days"
      );
      if (daysDiff == 0) {
        const interval = setInterval(async () => {
          if (dayjs(expiryDate).isBefore(dayjs().add(2, "hours").toDate())) {
            store.clear();
            await PowerShell.disconnectPowershell();
            loadPage("LOGIN");
            clearInterval(interval);
          }
        }, 1000 * 60 * 10);
      }
    } catch (error) {
      store.clear();
    }
  }
  setTimeout(() => {
    mainWindow.setSize(400, 595);
    positioner.move("bottomRight");
    loadPage(!userCredentials ? "LOGIN" : "HOME");
  }, 1500);

  store.delete("status");
  await PowerShell.disconnectPowershell();
  tray = new Tray(icon);

  const contextMenu = Menu.buildFromTemplate([
    {
      label: "Show",
      click() {
        mainWindow.show();
      },
    },
    {
      label: "Disconnect",
      async click() {
        await PowerShell.disconnectPowershell();
        mainWindow.webContents.send("disconnect-vpn", true);
        store.set("status", "DISCONNECTED");
        Helpers.pushNotification({
          title: "Spectre VPN",
          requireInteraction: false,
          body: "Disconnected",
          silent: false,
          icon,
          hasReply: false,
          timeoutType: "default",
        });
        try {
          await AxiosManager.requestPrivate(
            "PATCH",
            "/v1/user/vpn-disconnect",
            {},
            safeStorage.decryptString(Buffer.from(userCredentials.token, "hex"))
          );
        } catch (error) {}
      },
    },
    {
      label: "About",
      click() {
        mainWindow.loadFile(
          path.join(__dirname, "pages", "about", "about.html")
        );
        // const userCredentials = store.get("credentials");
        //     userCredentials
        //       ? mainWindow.loadFile(
        //           path.join(__dirname, "pages", "home", "home.html")
        //         )
        //       : mainWindow.loadFile(
        //           path.join(__dirname, "pages", "login", "login.html")
        //         );
      },
    },
    {
      label: "Logout",
      async click() {
        const response = Helpers.showMessageDialogSync(mainWindow, {
          title: "Spectre VPN",
          message: "Are you sure you want to logout?",
          type: "warning",
          buttons: ["Yes", "Cancel"],
          defaultId: 1,
          cancelId: 1,
          detail: "Please confirm if you want to logout",
          noLink: false,
        });

        if (response == 0) {
          const userCredentials = store.get("credentials");
          await PowerShell.disconnectPowershell();
          if (userCredentials) {
            try {
              await AxiosManager.requestPrivate(
                "GET",
                "/v1/user/logout",
                {},
                safeStorage.decryptString(
                  Buffer.from(userCredentials.token, "hex")
                )
              );
              try {
                await AxiosManager.requestPrivate(
                  "PATCH",
                  "/v1/user/vpn-disconnect",
                  {},
                  safeStorage.decryptString(
                    Buffer.from(userCredentials.token, "hex")
                  )
                );
              } catch (error) {}
              store.clear();
              mainWindow.loadFile(
                path.join(__dirname, "pages", "login", "login.html")
              );
            } catch (error) {}
          }
        }
      },
    },
    {
      label: "Exit",
      async click() {
        await PowerShell.disconnectPowershell();
        try {
          await AxiosManager.requestPrivate(
            "PATCH",
            "/v1/user/vpn-disconnect",
            {},
            safeStorage.decryptString(Buffer.from(userCredentials.token, "hex"))
          );
        } catch (error) {}
        app.exit();
      },
    },
  ]);

  tray.setToolTip("Spectre VPN");
  tray.setContextMenu(contextMenu);
  tray.on("click", function () {
    if (mainWindow.isVisible()) {
      mainWindow.hide();
    } else {
      mainWindow.show();
    }
  });
});

app.on("browser-window-blur", function () {
  if (mainWindow.getBounds().height != 400)
    // mainWindow.minimize();
    mainWindow.hide();
});

app.on("browser-window-focus", function () {
  if (mainWindow.getBounds().height == 400) mainWindow.show();
});
app.on("window-all-closed", function () {
  if (process.platform !== "darwin") app.quit();
});

powerMonitor.on("shutdown", async () => {
  if (store.get("status") == "CONNECTED") {
    await PowerShell.disconnectPowershell();
    try {
      await AxiosManager.requestPrivate(
        "PATCH",
        "/v1/user/vpn-disconnect",
        {},
        safeStorage.decryptString(Buffer.from(userCredentials.token, "hex"))
      );
    } catch (error) {}
  }

  try {
    await AxiosManager.requestPrivate(
      "PATCH",
      "/v1/user/vpn-disconnect",
      {},
      safeStorage.decryptString(Buffer.from(userCredentials.token, "hex"))
    );
  } catch (e) {}
  app.quit();
});

ipcMain.handle("close-window", (_, data) => {
  mainWindow.close();
});

ipcMain.handle("minimize-window", (_, data) => {
  mainWindow.minimize();
});

ipcMain.on("redirect-to-chrome", async (e, message) => {
  shell.openExternal(message);
});

ipcMain.on("close-about", async (e, message) => {
  const userCredentials = store.get("credentials");
  userCredentials
    ? mainWindow.loadFile(path.join(__dirname, "pages", "home", "home.html"))
    : mainWindow.loadFile(path.join(__dirname, "pages", "login", "login.html"));
});

ipcMain.on("isAlreadyLoggedIn", async (e, message) => {
  const userCredentials = store.get("credentials");
  const status = store.get("status") ?? "DISCONNECTED";
  const timer = store.get("timer") ?? {
    seconds: "00",
    minutes: "00",
    hours: "00",
  };

  if (userCredentials) {
    e.sender.send("handover-data", {
      username: userCredentials.username,
      expiryDate: dayjs(userCredentials.expiryDate).format("DD/MM/YYYY"),
      expiryDateInDays: dayjs(userCredentials.expiryDate).diff(
        new Date(),
        "days"
      ),
      timer,
      status,
    });
  }
});

ipcMain.on("save-previous-timer", async (e, message) => {
  const status = store.get("status") ?? "DISCONNECTED";
  if (status == "CONNECTED") {
    store.set("timer", {
      ...message,
    });
  }
});

ipcMain.on("is-timer-still-running", async (e, message) => {
  const status = store.get("status") ?? "DISCONNECTED";

  if (status == "CONNECTED") {
    const timer = store.get("timer") ?? {
      seconds: 0,
      minutes: 0,
      hours: 0,
    };

    e.sender.send("increment-timer", {
      seconds: timer.seconds,
      minutes: timer.minutes,
      hours: timer.hours,
    });
  }
});

ipcMain.on("login", async (e, message) => {
  try {
    const response = await AxiosManager.requestPublic(
      "POST",
      "/v1/user/login",
      {
        ...message,
        PCFingerprint: nodeMachineId.machineIdSync({ original: true }),
      }
    );

    e.sender.send("login", {
      success: true,
      ...response.data,
    });
  } catch (error) {
    e.sender.send("login", {
      success: false,
      username: message.username,
      password: message.password,
      error: error.response.data,
    });
  }
});

ipcMain.on("logout", async (e, message) => {
  const response = Helpers.showMessageDialogSync(mainWindow, {
    title: "Spectre VPN",
    message: "Are you sure you want to logout?",
    type: "warning",
    buttons: ["Yes", "Cancel"],
    defaultId: 1,
    cancelId: 1,
    detail: "Please confirm if you want to logout",
    noLink: false,
  });

  if (response == 0) {
    const userCredentials = store.get("credentials");

    if (userCredentials) {
      try {
        await AxiosManager.requestPrivate(
          "GET",
          "/v1/user/logout",
          {},
          safeStorage.decryptString(Buffer.from(userCredentials.token, "hex"))
        );
      } catch (error) {}
      store.clear();
    }
    await PowerShell.disconnectPowershell();
    try {
      await AxiosManager.requestPrivate(
        "PATCH",
        "/v1/user/vpn-disconnect",
        {},
        safeStorage.decryptString(Buffer.from(userCredentials.token, "hex"))
      );
    } catch (error) {}

    mainWindow.loadFile(path.join(__dirname, "pages", "login", "login.html"));
  }
});

ipcMain.on("promoCode", async (e, message) => {
  try {
    const response = await AxiosManager.requestPublic(
      "POST",
      "/v1/promo-code/use-promo-code",
      {
        code: message.code.trim(),
        PCFingerprint: nodeMachineId.machineIdSync({ original: true }),
      }
    );
    e.sender.send("handle-promo-code", {
      success: true,
      ...response.data,
    });
  } catch (error) {
    e.sender.send("handle-promo-code", {
      success: false,
      error: error.response.data,
    });
  }
});

ipcMain.on("save-account-on-desktop", async (e, message) => {
  Helpers.saveCredentials(
    message.username,
    message.password,
    message.trialText
  );
});

ipcMain.on("save-credentials", async (e, message) => {
  try {
    store.set("credentials", {
      token: safeStorage.encryptString(message.token).toString("hex"),
      _id: safeStorage.encryptString(message._id).toString("hex"),
      username: message.username,
      expiryDate: message.expiryDate,
      connection: message.connection,
    });

    mainWindow.loadFile(path.join(__dirname, "pages", "home", "home.html"));

    mainWindow.webContents.on("did-finish-load", function () {
      e.sender.send("handover-data", {
        username: message.username,
        expiryDate: dayjs(message.expiryDate).format("DD/MM/YYYY"),
        expiryDateInDays: dayjs(message.expiryDate).diff(new Date(), "days"),
      });
    });
  } catch (error) {}
});

ipcMain.on("trigger-connection", async (e, message) => {
  const userCredentials = store.get("credentials");

  try {
    const status = store.get("status");
    if (!status || status == "DISCONNECTED") {
      e.sender.send("freeze-button", true);
      store.set("status", "FREEZE");
      store.delete("timer");
      const canPass = await Helpers.startVpn({
        host: userCredentials.connection.host,
        username: userCredentials.connection.name,
        password: decrypt({
          iv: userCredentials.connection.secret.split("$")[0],
          encryptedText: userCredentials.connection.secret.split("$")[1],
        }),
      });

      if (canPass) {
        store.set("status", "CONNECTED");
        e.sender.send("connect-vpn", true);
        Helpers.pushNotification({
          title: "Spectre VPN",
          requireInteraction: false,
          body: "Connected",
          silent: false,
          icon,
          hasReply: false,
          timeoutType: "default",
        });
        try {
          await AxiosManager.requestPrivate(
            "PATCH",
            "/v1/user/vpn-connect",
            {},
            safeStorage.decryptString(Buffer.from(userCredentials.token, "hex"))
          );
        } catch (error) {}
      } else {
        e.sender.send("disconnect-vpn", true);
        await PowerShell.disconnectPowershell();
        store.delete("timer");
        store.set("status", "DISCONNECTED");
        Helpers.pushNotification({
          title: "Spectre VPN",
          requireInteraction: false,
          body: "Disconnected",
          silent: false,
          icon,
          hasReply: false,
          timeoutType: "default",
        });
        try {
          await AxiosManager.requestPrivate(
            "PATCH",
            "/v1/user/vpn-disconnect",
            {},
            safeStorage.decryptString(Buffer.from(userCredentials.token, "hex"))
          );
        } catch (error) {}
      }
    } else if (status == "CONNECTED") {
      store.set("status", "DISCONNECTED");
      await PowerShell.disconnectPowershell();

      e.sender.send("disconnect-vpn", true);

      // store.delete("timer");
      Helpers.pushNotification({
        title: "Spectre VPN",
        requireInteraction: false,
        body: "Disconnected",
        silent: false,
        icon,
        hasReply: false,
        timeoutType: "default",
      });

      try {
        await AxiosManager.requestPrivate(
          "PATCH",
          "/v1/user/vpn-disconnect",
          {},
          safeStorage.decryptString(Buffer.from(userCredentials.token, "hex"))
        );
      } catch (error) {}
    }
  } catch (error) {}
});

// app.setLoginItemSettings({
//   openAtLogin: true,
// });
