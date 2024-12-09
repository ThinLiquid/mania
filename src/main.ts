import './style.css'
import eruda from 'eruda'

import { Unzipped, unzipSync } from 'fflate'
import { OsuSkinParser } from './parsers/OsuSkinParser'
import * as PIXI from 'pixi.js'
import { BeatmapDecoder } from 'osu-parsers'

eruda.init()

const SKIN_ZIP = '/Simplified Orbs 4k 7k.osk'
const MAP_ZIP = '/1979887 B-Komachi Ai (CV_ Takahashi Rie) - Sign wa B -Ai Solo Ver.-.osz'

const fetchZip = async (url: string): Promise<Unzipped> => {
  const response = await fetch(url)
  if (!response.ok) throw new Error(`Failed to fetch: ${url}`)
  const zipBuffer = await response.arrayBuffer()

  return unzipSync(new Uint8Array(zipBuffer))
}

class AssetManager {
  private assets: Record<string, Unzipped> = {}
  preloadedTextures: Record<string, Array<{
    src: string,
    type: string
  }>> = {}
  pixiTextures: Record<string, PIXI.Texture> = {}

  async loadZip(name: string, url: string): Promise<Unzipped> {
    const tempObj = await fetchZip(url)

    this.assets[name] = Object.keys(tempObj).reduce((acc: Record<string, Uint8Array>, key) => {
      acc[key.toLowerCase()] = tempObj[key];
      return acc;
    }, {} as Record<string, Uint8Array>);

    return this.assets[name]
  }

  getZip(name: string): Unzipped | undefined {
    return this.assets[name]
  }

  fileAsUrl(zip: Unzipped, file: string, type = 'image/png') {
    return URL.createObjectURL(new Blob([zip[file]], { type }))
  }

  textureAsUrl(zip: Unzipped, file: string, type = 'image/png') {
    file = file.toLowerCase();

    if (!this.preloadedTextures[file]) {
      this.preloadedTextures[file] = []
    }

    if (!this.preloadedTextures[file].find(texture => texture.type === '1x')) {
      this.preloadedTextures[file].push({
        src: URL.createObjectURL(new Blob([zip[`${file}.png`]], { type })),
        type: '1x'
      })
    }

    if (zip[`${file}@2x.png`] && !this.preloadedTextures[file].find(texture => texture.type === '2x')) {
      this.preloadedTextures[file].push({
        src: URL.createObjectURL(new Blob([zip[`${file}@2x.png`]], { type })),
        type: '2x'
      })
    }

    return this.preloadedTextures[file];
  }

  getSkinTexture(file: string): PIXI.Texture {
    const textures = this.preloadedTextures[file];
    if (!textures) throw new Error(`Texture not found: ${file}`)

    const selectedTexture = textures.find(t => t.type === '2x') || textures.find(t => t.type === '1x')
  
    if (!selectedTexture) throw new Error(`Texture not found: ${file}`)
  
    let pixiTexture = this.pixiTextures[file];
    if (!pixiTexture) {
      pixiTexture = PIXI.Texture.from(selectedTexture.src);
      this.pixiTextures[file] = pixiTexture;
    }
  
    return pixiTexture;
  }  

  async preloadSkinTextures(skin: Unzipped, keyConfig: any) {
    const allTextures = [
      ...Object.keys(keyConfig).filter(key =>
        key.includes('Image') ||
        key.startsWith('Stage')
      ).map(key => keyConfig[key].toLowerCase()),
    ];

    for (const imageKey of allTextures) {
      const file = imageKey.toLowerCase();
      this.textureAsUrl(skin, file);
      
      if (!this.pixiTextures[file]) {
        try {
          const textureData = this.preloadedTextures[file].map(t => t.src);
          this.pixiTextures[file] = await PIXI.Assets.load({
            src: textureData,
            format: 'png',
            loadParser: 'loadTextures'
          });
        } catch (error) {
          console.error(`Error loading texture: ${file}`, error);
        }
      }
    }

    console.log(this.preloadedTextures, this.pixiTextures);
  }

  cleanup() {
    for (const textures of Object.values(this.preloadedTextures)) {
      for (const texture of textures) {
        URL.revokeObjectURL(texture.src);
      }
    }
    this.preloadedTextures = {};
  }
}


class InputHandler {
  private keys: Record<string, boolean> = {}; // Track key states
  private keybinds: Record<string, number> = {}; // Map keys to columns
  private onKeyDown: (key: string, index: number) => void;
  private onKeyUp: (key: string, index: number) => void;

  constructor(
    keybinds: string[],
    onKeyDown: (key: string, index: number) => void,
    onKeyUp: (key: string, index: number) => void
  ) {
    this.setKeybinds(keybinds);
    this.onKeyDown = onKeyDown;
    this.onKeyUp = onKeyUp;

    window.addEventListener('keydown', this.handleKeyDown.bind(this));
    window.addEventListener('keyup', this.handleKeyUp.bind(this));
  }

  setKeybinds(keybinds: string[]) {
    this.keybinds = {};
    keybinds.forEach((key, index) => {
      this.keybinds[key.toLowerCase()] = index;
    });
  }

  handleKeyDown(event: KeyboardEvent) {
    const key = event.key.toLowerCase();
    if (this.keys[key] || !(key in this.keybinds)) return; // Ignore if already pressed or unbound
    this.keys[key] = true;

    const index = this.keybinds[key];
    this.onKeyDown(key, index);
  }

  handleKeyUp(event: KeyboardEvent) {
    const key = event.key.toLowerCase();
    if (!this.keys[key] || !(key in this.keybinds)) return; // Ignore if not pressed or unbound
    this.keys[key] = false;

    const index = this.keybinds[key];
    this.onKeyUp(key, index);
  }

  cleanup() {
    window.removeEventListener('keydown', this.handleKeyDown);
    window.removeEventListener('keyup', this.handleKeyUp);
  }
}


class Game {
  app: PIXI.Application
  assetManager: AssetManager
  skinParser: OsuSkinParser

  keys = 4
  downscroll = true

  audio = new Audio()
  video = document.createElement('video')

  keySprites: PIXI.Sprite[] = []

  keybinds = ['a', 's', 'k', 'l']

  skinConfig: Record<string, any> = {}
  keyConfig: Record<string, any> = {}

  scaled: Record<string, any> = {}

  scrollSpeed: number = 542; // (ms) the higher, the more dense
  hitObjectSprites: PIXI.Sprite[] = []

  beatmap: ReturnType<BeatmapDecoder['decodeFromString']> | null = null

  inputHandler: InputHandler;

  stageContainer: PIXI.Container;
  noteContainer: PIXI.Container;

  constructor() {
    this.app = new PIXI.Application()

    this.assetManager = new AssetManager()
    this.skinParser = new OsuSkinParser()

    this.inputHandler = new InputHandler(
      this.keybinds,
      this.handleKeyDown.bind(this),
      this.handleKeyUp.bind(this)
    );

    this.stageContainer = new PIXI.Container();
    this.noteContainer = new PIXI.Container();

    this.video.muted = true

    this.init()
  }

  async init() {
    await this.app.init({
      width: window.innerWidth,
      height: window.innerHeight,
      resizeTo: window,
      backgroundAlpha: 0,
      resolution: window.devicePixelRatio || 1,
    });
    this.app.stage.eventMode = "passive";

    document.body.appendChild(this.app.canvas);

    const skin = await this.assetManager.loadZip('skin', SKIN_ZIP);

    const rawSkinConfig = new TextDecoder().decode(skin['skin.ini']);
    this.skinConfig = new OsuSkinParser().parse(rawSkinConfig);
    this.keyConfig = this.skinConfig[`Mania${this.keys}K`];

    const map = await this.assetManager.loadZip('map', MAP_ZIP);

    console.log(map);

    const rawBeatmap = new TextDecoder().decode(map['B-Komachi Ai (CV Takahashi Rie) - Sign wa B -Ai Solo Ver.- (Drum-Hitnormal) [Hidden\'s Easy].osu'.toLowerCase()]);
    console.log(rawBeatmap);
    this.beatmap = new BeatmapDecoder().decodeFromString(rawBeatmap);

    console.log(this.beatmap.events.storyboard?.variables.values())

    console.log( )


    if (this.beatmap.events.backgroundPath) {
      ;(document.querySelector('bg') as HTMLElement).style.background = `url('${this.assetManager.fileAsUrl(map, this.beatmap.events.backgroundPath)}')`
      ;(document.querySelector('bg') as HTMLElement).style.backgroundSize = 'cover'
    }

    if (this.beatmap.events.storyboard?.getLayerByName('Video').elements[0].filePath) {
      document.querySelector('bg')!.appendChild(this.video)
      this.video.src = this.assetManager.fileAsUrl(map, this.beatmap.events.storyboard?.getLayerByName('Video').elements[0].filePath)
    }
    

    this.audio.src = this.assetManager.fileAsUrl(map, this.beatmap.general.audioFilename, 'audio/mpeg');

    console.log('hi');
    console.log(this.beatmap.general.audioFilename, this.audio.src);

    console.debug(this.keyConfig);

    await this.assetManager.preloadSkinTextures(skin, this.keyConfig);

    this.scaled.HitPosition = this.app.canvas.height - this.keyConfig.HitPosition * 1.6;
    this.scaled.ColumnStart = (this.keyConfig.ColumnStart / 384) / 1.6 * this.app.canvas.width;

    this.createColumns();
    this.createStage();

    this.createHitObjects();
    window.onclick = async () => {
      await this.audio.play();
      await this.video.play()
      this.updateHitObjects();
    };
  }

  createColumns () {
    for (let i = 0; i < this.keys; i++) {
      const texture = this.assetManager.getSkinTexture(this.keyConfig[`KeyImage${i}`])
      const sprite = new PIXI.Sprite(texture)

      sprite.width = this.keyConfig.ColumnWidth[i]
      sprite.height = texture.height
      sprite.x = (i * this.keyConfig.ColumnWidth[i]) + this.scaled.ColumnStart
      
      sprite.y = this.downscroll ? this.scaled.HitPosition - (sprite.height / 1.6) : this.keyConfig.HitPosition;

      sprite.zIndex = this.keyConfig.KeysUnderNotes === '1' ? 1 : 2

      const background = new PIXI.Graphics()
        .rect((i * this.keyConfig.ColumnWidth[i]) + this.scaled.ColumnStart, 0, this.keyConfig.ColumnWidth[i], this.app.screen.height)
        .fill({
          color: this.keyConfig[`Colour${i + 1}`]
        })

      this.keySprites[i] = sprite

      this.app.stage.addChild(background)
      this.app.stage.addChild(sprite)
    }
  }

  createStage () {
    const totalWidth = this.keyConfig.ColumnWidth.reduce((a: number, b: number)=>a+b,0);
    const centerX = this.scaled.ColumnStart + totalWidth / 2;

    const stageBottomTexture = this.assetManager.getSkinTexture(this.keyConfig.StageBottom)
    const stageBottom = new PIXI.Sprite(stageBottomTexture)
    stageBottom.width *= 1.6
    stageBottom.height *= 1.6
    stageBottom.y = this.app.canvas.height - stageBottom.height
    stageBottom.x = centerX - stageBottom.width / 2;

    const stageRightTexture = this.assetManager.getSkinTexture(this.keyConfig.StageRight)
    const stageRight = new PIXI.Sprite(stageRightTexture)
    stageRight.height = this.app.canvas.height
    stageRight.y = 0
    stageRight.x = centerX - (totalWidth / 2) - stageRight.width

    const stageLeftTexture = this.assetManager.getSkinTexture(this.keyConfig.StageRight)
    const stageLeft = new PIXI.Sprite(stageLeftTexture)
    stageLeft.height = this.app.canvas.height
    stageLeft.y = 0
    stageLeft.x = centerX + (totalWidth / 2)

    this.app.stage.addChild(stageRight)
    this.app.stage.addChild(stageLeft)
    this.app.stage.addChild(stageBottom)

    const judgementLine = new PIXI.Graphics()
      .rect(this.scaled.ColumnStart, this.scaled.HitPosition, totalWidth, 1)
      .fill({
        color: this.keyConfig['ColourJudgementLine'],
        alpha: this.keyConfig['JudgementLine'] === '1' ? 0.9 : 0
      })
    
    this.app.stage.addChild(judgementLine)
  }

  createHitObjects() {
    for (const hitObject of this.beatmap!.hitObjects) {
      const col = Math.floor(hitObject.startX * this.keys / 512);
      const isHold = hitObject.hitType === 128;
  
      const texture = this.assetManager.getSkinTexture(this.keyConfig[isHold ? `NoteImage${col}H` : `NoteImage${col}`]);
      const hitObjectSprite = new PIXI.Sprite(texture);
      hitObjectSprite.width = this.keyConfig.ColumnWidth[col];
      hitObjectSprite.height = this.keyConfig.ColumnWidth[col];
      hitObjectSprite.x = this.scaled.ColumnStart + (col * this.keyConfig.ColumnWidth[col]);
      hitObjectSprite.y = -hitObjectSprite.height;
      hitObjectSprite.visible = false;
  
      hitObjectSprite.startTime = hitObject.startTime;
      hitObjectSprite.endTime = isHold ? hitObject.endTime : -1; // Set the end time for hold notes
      hitObjectSprite.isHold = isHold;
  
      this.hitObjectSprites.push(hitObjectSprite);
      this.app.stage.addChild(hitObjectSprite);
    }
  }
  

  updateHitObjects() {
    const currentTime = this.audio.currentTime * 1000;
    const screenBottom = this.app.screen.height;

    for (let i = this.hitObjectSprites.length - 1; i >= 0; i--) {
        const hitObject = this.hitObjectSprites[i];
        const timeToHit = hitObject.startTime - currentTime - this.scrollSpeed;

        if (timeToHit < 0 && !hitObject.visible) {
            hitObject.visible = true;
        }

        hitObject.y = (timeToHit / this.scrollSpeed) * -this.scaled.HitPosition - hitObject.height;

        if (hitObject.y >= screenBottom) {
            this.hitObjectSprites.splice(i, 1);
            hitObject.destroy();
        }
    }

    requestAnimationFrame(this.updateHitObjects.bind(this));
  }

  handleKeyDown(key: string, index: number) {
    const textureKey = `KeyImage${index}D`;
    this.keySprites[index].texture = this.assetManager.getSkinTexture(this.keyConfig[textureKey]);
    console.log(`Key pressed: ${key}, Column: ${index}`);
  }

  handleKeyUp(key: string, index: number) {
    const textureKey = `KeyImage${index}`;
    this.keySprites[index].texture = this.assetManager.getSkinTexture(this.keyConfig[textureKey]);
    console.log(`Key released: ${key}, Column: ${index}`);
  }

  cleanup() {
    this.inputHandler.cleanup();
    this.assetManager.cleanup();
  }
  
}

new Game()