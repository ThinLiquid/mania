export const DEFAULT_SKIN = {
  Mania4K: {
    KeyImage0: 'mania-key1',
    KeyImage1: 'mania-key2',
    KeyImage2: 'mania-key2',
    KeyImage3: 'mania-key1',

    KeyImage0D: 'mania-key1d',
    KeyImage1D: 'mania-key2d',
    KeyImage2D: 'mania-key2d',
    KeyImage3D: 'mania-key1d',

    NoteImage0: 'mania-note1',
    NoteImage1: 'mania-note2',
    NoteImage2: 'mania-note2',
    NoteImage3: 'mania-note1',
    
    StageLeft: 'mania-stage-left',
    StageRight: 'mania-stage-right',
    StageBottom: 'mania-stage-bottom',
    StageHint: 'mania-stage-hint',

    ColourJudgementLine: [255,255,255],

    JudgementLine: '1'
  }
}

const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max);

export class ManiaSkinConfiguration {
  static POSITION_SCALE_FACTOR = 1.6

  static DEFAULT_COLUMN_SIZE = 30 * this.POSITION_SCALE_FACTOR

  static DEFAULT_HIT_POSITION = (480 - 402) * this.POSITION_SCALE_FACTOR

  Keys: number

  CustomColors = new Map<string, [number, number, number, number]>()

  ImageLookups = new Map<string, string>()

  WidthForNoteScale: number = -1

  ColumnLineWidth: number[] // doesnt use scale
  ColumnSpacing: number[]
  ColumnWidth: number[]
  ExplosionWidth: number[]
  HoldNoteLightWidth: number[]

  HitPosition = ManiaSkinConfiguration.DEFAULT_HIT_POSITION
  LightPosition = (480 - 413) * ManiaSkinConfiguration.POSITION_SCALE_FACTOR
  ComboPosition = 111 * ManiaSkinConfiguration.POSITION_SCALE_FACTOR
  ScorePosition = 300 * ManiaSkinConfiguration.POSITION_SCALE_FACTOR
  ShowJudgementLine = true
  KeysUnderNotes: boolean = false
  LightFramePerSecond = 60

  constructor(keys: number) {
    this.Keys = keys;

    this.ColumnLineWidth = new Array(keys + 1).fill(2);
    this.ColumnSpacing = new Array(keys - 1);
    this.ColumnWidth = new Array(keys).fill(ManiaSkinConfiguration.DEFAULT_COLUMN_SIZE);
    this.ExplosionWidth = new Array(keys);
    this.HoldNoteLightWidth = new Array(keys);
  }
}

export class OsuSkinParser {
  parseArrayValue(value: string, applyScaleFactor = true) {
    const output: number[] = []
    const values = value.split(',')

    for (let i = 0; i < values.length; i++) {
      let parsedValue = parseFloat(values[i])
      if (!parsedValue) parsedValue = 0

      if (applyScaleFactor)
        parsedValue *= ManiaSkinConfiguration.POSITION_SCALE_FACTOR;

      output[i] = parsedValue;
    }
    return output
  }

  parse(content: string) {
    const configData: Record<string, any> = DEFAULT_SKIN;
  
    const lines = content.split('\n').map(x => x.trim());
  
    let currentSection = '';
    let keysFound = false;
  
    for (const line of lines) {
      // Skip empty lines or comments
      if (line.trim() === '' || line.trim().startsWith('//')) continue;
  
      // Check for section headings
      if (line.startsWith('[') && line.endsWith(']')) {
        currentSection = line.split('[')[1].split(']')[0].trim();
        keysFound = false;
        continue;
      }
  
      // Check for the Keys key before processing Mania section
      if (currentSection === 'Mania' && !keysFound && line.split(':')[0].trim() === 'Keys') {
        const value = line.split(':')[1].trim();
        // Assign the Keys value to currentSection
        currentSection = `${currentSection}${value}K`;
        keysFound = true; // Mark Keys as found
      }
  
      // Process the key-value pair
      const key = line.split(':')[0].trim();
      let value: number | string | Array<number> = line.split(':')[1].trim().toLowerCase();

      if (key === 'ColumnWidth') {
        value = this.parseArrayValue(value);
      } else if (key === 'HitPosition') {
        value = (480 - clamp(parseFloat(value), 240, 480))
      } else if (key === 'ColumnStart') {
        value = parseFloat(value)
      } else if (key.startsWith('Colour')) {
        value = this.parseArrayValue(value, false)
      }
      
      // Ensure the current section is added if not already
      if (!(currentSection in configData)) configData[currentSection] = {};
  
      configData[currentSection][key] = value;
    }

    console.debug(configData)
  
    return configData;
  }  
}