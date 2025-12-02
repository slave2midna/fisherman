// main.mjs – unified fishing minigame module script
// Includes:
//  - moduleName + dev-mode logging
//  - FishingUi + FishingApplication
//  - FishingSpotPageSheet
//  - Foundry init/ready hooks

import { systemShim } from "./systemShims/theRealShimShady.mjs";

export const moduleName = "obligatory-fishing-minigame";

/* ------------------------------------------------------------------------- */
/* Dev-mode logging helper                                                   */
/* ------------------------------------------------------------------------- */

Hooks.on("devModeReady", ({ registerPackageDebugFlag }) =>
  registerPackageDebugFlag(moduleName)
);

export function log(force, ...args) {
  try {
    const isDebugging = game.modules
      .get("_dev-mode")
      ?.api?.getPackageDebugValue(moduleName);

    if (force || isDebugging) {
      console.log(moduleName, "|", ...args);
    }
  } catch (e) {
    // ignore
  }
}

/* ------------------------------------------------------------------------- */
/* Fishing UI                                                                */
/* ------------------------------------------------------------------------- */

export class FishingUi {
  static app = null;

  /**
   * Open the fishing minigame.
   * @param {Function} callback  Called with (isCodEmperor: boolean) on success
   */
  static run(callback = () => {}) {
    this.app = new FishingApplication(callback, {});
    this.app.render(true);
  }
}

/* -------------------------------------------- */

class FishingApplication extends Application {
  constructor(callback, options) {
    super(options);

    this.callback = callback;

    // Settings data
    this.fish = {
      jumpRange: 100, // Jumping range, between 0-100, lower means less movement
      speed: 1000, // Movement speed in ms
      depth: 20, // Spawn starting percentage
      movepremsec: 1500, // How often the Fish changes position
      codEmperor: false // Is the fish the mythical Cod Emperor?
    };

    this.rod = {
      reeling: false,
      reelPower: 10,          // Bait move speed. Higher = easier
      baitWeight: 1,          // Bait weight. Lower = faster
      progress: 2,            // Progress gain percentage per interval
      progressPenalty: 0,     // Progress loss percentage per interval
      progressUpdateRate: 200,
      progressUpdated: false
    };

    // Is this the mythical Cod Emperor?
    const result = Math.floor(Math.random() * 1002) + 1;
    if (result === 1002) {
      this.fish.speed = 500;
      this.fish.movepremsec = 2000;
      this.rod.progress = 1;
      this.rod.progressPenalty = 2;
      this.fish.codEmperor = true;
      ui.notifications.warn(
        "You have encountered the mythical Cod Emperor - prepare for a fight!"
      );
    }

    // Adjust difficulty based on the fisher's stats
    if (game.user.character) {
      const shim = systemShim(game.user.character);
      if (shim) {
        // Mod values tend to range from -2 to +5
        this.rod.progress = Math.min(15, this.rod.progress + shim.str);
        this.rod.baitWeight = Math.max(
          0.5,
          this.rod.baitWeight - shim.con * 0.1
        );
        this.fish.speed = Math.min(1500, this.fish.speed + shim.wis * 100);
        this.fish.jumpRange = Math.min(
          50,
          this.fish.jumpRange - shim.cha * 5
        );
        this.fish.movepremsec = Math.min(
          2000,
          this.fish.movepremsec + shim.dex * 200
        );
      }
    }

    // Setup timers
    this.baitTimer = null;
    this.moveFishTimer = null;
    this.progressBarTimeout = null;

    // Start interactivity
    // Move bait up if reeling
    this.baitTimer = setInterval(() => {
      if (!window.obligatoryFishingMinigame?.reeling) {
        $(".fishing .rod .reel .handle").removeClass("reelin");
        $("#bait").stop(true);
        this.reelgravity(this);
        this.checkOverlapping(this);
        return;
      }

      $(".fishing .rod .reel .handle")
        .removeClass("reelout")
        .addClass("reelin");

      $("#bait").animate(
        { top: "-=" + $(".fishing").data("reelpower") + "%" },
        {
          easing: "linear",
          step: (now) => {
            if (now <= 0) $("#bait").stop(true);
            this.checkOverlapping(this);
          }
        }
      );
    }, 400);

    // Move fish
    this.moveFishTimer = setInterval(() => {
      if (this.fish.codEmperor) {
        $(".fish")[0]?.classList.add("cod-emperor");
      }

      const fishEl = $(".fishing .sea .fish")[0];
      if (!fishEl) return;

      let currentposition = parseInt(fishEl.style.top) || 0;
      let movedirection =
        Math.floor(Math.random() * currentposition) +
        Math.abs(currentposition - this.fish.jumpRange);

      $(".fishing .sea .fish").animate(
        { top: (movedirection <= 89 ? movedirection : 89) + "%" },
        {
          duration: this.fish.speed,
          step: (now) => {
            if (now <= 0) $(".fishing .sea .fish").stop(true);
          }
        }
      );
    }, this.fish.movepremsec);
  }

  /* -------------------------------------------- */

  /** @override */
  static get defaultOptions() {
    return foundry.utils.mergeObject(super.defaultOptions, {
      title: "",
      template: `modules/${moduleName}/templates/fishing-ui.hbs`,
      height: 550,
      width: 150,
      popOut: true,
      minimizable: false,
      resizable: false,
      // Play nice with PopOut! module
      popOutModuleDisable: true,
      classes: ["fishing-ui"]
    });
  }

  /* -------------------------------------------- */

  /** @override */
  async close(options = {}) {
    this.reset();
    return super.close(options);
  }

  /* -------------------------------------------- */

  progressbar(app, overlapping) {
    const barEl = $(".fishing .progress .bar")[0];
    if (!barEl) return;

    let progressbarheight = parseFloat(barEl.style.height) || 0;

    if (overlapping) {
      if (progressbarheight < 100) {
        $(".fishing .progress .bar").animate(
          {
            height:
              progressbarheight + $(".fishing").data("progress") + "%"
          },
          $(".fishing").data("progressupdaterate"),
          "linear"
        );
      } else {
        this.fishCaught();
      }
    } else {
      if (progressbarheight > 0) {
        $(".fishing .progress .bar").animate(
          {
            height:
              progressbarheight - app.rod.progressPenalty + "%"
          },
          app.rod.progressUpdateRate,
          "linear"
        );
      }
    }

    app.rod.progressUpdated = false;
  }

  /* -------------------------------------------- */

  reelgravity(app) {
    const baitEl = $("#bait")[0];
    if (!baitEl) return;

    let baitHeight = parseFloat(baitEl.style.top) || 0;
    if (baitHeight < 78.5) {
      $(".fishing .rod .reel .handle").addClass("reelout");
    } else {
      $(".fishing .rod .reel .handle").removeClass("reelout");
    }

    $("#bait").animate(
      { top: "79%" },
      {
        duration: parseFloat(app.rod.baitWeight) * 1000,
        complete: function () {
          $(".fishing .rod .reel .handle").removeClass("reelout");
        },
        step: () => {
          app.checkOverlapping(app);
        }
      }
    );
  }

  /* -------------------------------------------- */

  checkOverlapping(app) {
    const bait = $("#bait")[0];
    const fish = $(".fishing .sea .fish")[0];
    if (!bait || !fish) return;

    let baitbound = bait.getBoundingClientRect();
    let fishbound = fish.getBoundingClientRect();

    let overlapping = !(
      baitbound.right < fishbound.left ||
      baitbound.left > fishbound.right ||
      baitbound.bottom < fishbound.top ||
      baitbound.top > fishbound.bottom
    );

    if (!app.rod.progressUpdated) {
      app.rod.progressUpdated = true;
      clearTimeout(app.progressBarTimeout);
      app.progressBarTimeout = setTimeout(() => {
        app.progressbar(app, overlapping);
      }, app.rod.progressUpdateRate);
    }
  }

  /* -------------------------------------------- */

  reset() {
    clearInterval(this.baitTimer);
    clearInterval(this.moveFishTimer);
    clearTimeout(this.progressBarTimeout);
    $(".fishing .progress .bar").css("height", "0%");
  }

  /* -------------------------------------------- */

  fishCaught() {
    this.callback(this.fish.codEmperor);
    this.reset();
    this.close();
  }
}

/* ------------------------------------------------------------------------- */
/* Fishing Spot Page Sheet                                                   */
/* ------------------------------------------------------------------------- */

class FishingSpotPageSheet extends JournalPageSheet {
  /** @inheritdoc */
  static get defaultOptions() {
    const options = super.defaultOptions;
    options.classes.push("form");
    return options;
  }

  /* -------------------------------------------- */

  /** @inheritdoc */
  get template() {
    const base = `modules/${moduleName}/templates/journal`;
    return this.isEditable
      ? `${base}/page-fishingspot-edit.hbs`
      : `${base}/page-fishingspot-view.hbs`;
  }

  /* -------------------------------------------- */

  /**
   * FishingSpotData
   * @typedef {Object} FishingSpotData
   * @property {string} name
   * @property {string} description
   * @property {string} image
   * @property {string} fishRolltableUUID
   * @property {string} junkRolltableUUID
   * @property {string} treasureRolltableUUID
   */

  /* -------------------------------------------- */

  /** @inheritdoc */
  async getData(options = {}) {
    const data = await super.getData(options);

    /** @type {FishingSpotData} */
    let flagData = data.document.flags[moduleName];
    if (!flagData) {
      flagData = {
        name: "Fishing Spot",
        image: "",
        fishRolltableUUID: "",
        junkRolltableUUID: "",
        treasureRolltableUUID: ""
      };
    }

    // Metadata
    data.name = flagData.name;
    data.text = data.document.text;
    data.image = flagData.image;
    data.fishRolltableUUID = flagData.fishRolltableUUID;
    data.junkRolltableUUID = flagData.junkRolltableUUID;
    data.treasureRolltableUUID = flagData.treasureRolltableUUID;

    // Rolltables
    data.fishRolltable = this._getRolltable(flagData.fishRolltableUUID);
    data.junkRolltable = this._getRolltable(flagData.junkRolltableUUID);
    data.treasureRolltable = this._getRolltable(flagData.treasureRolltableUUID);

    // Keep a reference for _fishCaught
    this.data = data;

    return data;
  }

  /* -------------------------------------------- */

  async _updateObject(event, formData) {
    const updateData = foundry.utils.mergeObject(formData, {
      flags: {
        [moduleName]: formData
      }
    });
    return super._updateObject(event, updateData);
  }

  /* -------------------------------------------- */

  /** @inheritdoc */
  activateListeners(html) {
    super.activateListeners(html);

    // View sheet: start fishing button
    html.find(".start-fishing").on("click", () => {
      FishingUi.run((isCodEmperor) => {
        this._fishCaught(isCodEmperor);
      });
    });
  }

  /* -------------------------------------------- */

  async _fishCaught(isCodEmperor) {
    if (isCodEmperor) {
      // NOTE: still inline HTML; can be moved to an .hbs chat card later
      await ChatMessage.create({
        speaker: ChatMessage.getSpeaker(),
        content: `<h2>${game.user.name} has captured the mythical Cod-Emperor</h2>
                  <img src="/modules/${moduleName}/images/cod-emperor.png" width="200" height="200" />
                  <p>Fortunes will shine upon you for the rest of your fishing days.</p>`
      });
      return;
    }

    ui.notifications.info("Fish Caught!");

    let id = this.data.fishRolltableUUID;

    // A random number from 1 to 100
    let random = Math.floor(Math.random() * 100) + 1;

    const shim = systemShim(game.user.character);
    if (shim && game.user.character) random += shim.int;

    if (random <= 10) {
      id = this.data.junkRolltableUUID;
    } else if (random >= 90) {
      id = this.data.treasureRolltableUUID;
    }

    const rolltable = this._getRolltable(id);
    if (rolltable) {
      await rolltable.draw();
    }
  }

  /* -------------------------------------------- */

  /**
   * Get a RollTable by ID/UUID
   * @param {string} uuid
   * @returns {RollTable|undefined}
   * @private
   */
  _getRolltable(uuid) {
    if (!uuid) return undefined;
    return game.tables.get(uuid) ?? game.tables.contents.find(t => t.uuid === uuid);
  }
}

/* ------------------------------------------------------------------------- */
/* Foundry lifecycle hooks                                                   */
/* ------------------------------------------------------------------------- */

Hooks.once("init", async function () {
  // Keybinding: reel action
  game.keybindings.register(moduleName, "reel", {
    name: "Reel in",
    hint: "Tap or hold",
    editable: [{ key: "Space" }],
    onDown: () => {
      window.obligatoryFishingMinigame.reeling = true;
      return !!FishingUi.app?.rendered;
    },
    onUp: () => {
      window.obligatoryFishingMinigame.reeling = false;
      return !!FishingUi.app?.rendered;
    },
    reservedModifiers: [],
    precedence: CONST.KEYBINDING_PRECEDENCE.PRIORITY,
    repeat: true
  });

  // Register the Fishing Spot page sheet for text pages
  DocumentSheetConfig.registerSheet(
    JournalEntryPage,
    moduleName,
    FishingSpotPageSheet,
    {
      types: ["text"],
      label() {
        return "Fishing Spot Configuration";
      }
    }
  );
});

Hooks.once("ready", async function () {
  window.obligatoryFishingMinigame = {
    reeling: false
  };
  window.obligatoryFishingMinigame.log = log;

  // Auto-open minigame when dev-mode debug is enabled for this module
  if (
    game.modules.get("_dev-mode")?.api?.getPackageDebugValue(moduleName)
  ) {
    FishingUi.run();
  }
});
