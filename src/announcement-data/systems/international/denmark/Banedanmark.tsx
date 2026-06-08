import StationAnnouncementSystem from '@announcement-data/StationAnnouncementSystem'
import CustomAnnouncementPane, { ICustomAnnouncementPreset } from '@components/PanelPanes/CustomAnnouncementPane'
import { AudioItem, CustomAnnouncementTab } from '../../../AnnouncementSystem'

import BanedanmarkDestinationsPicker from './BanedanmarkDestinationsPicker'
import Destinations from './banedanmarkDestinations.json'

/**
 * Banedanmark (Danish State Railways infrastructure) platform announcements.
 *
 * Audio is bilingual: every announcement plays the full Danish version followed by the
 * full English version, mirroring real Banedanmark stations.
 *
 * Clip IDs are namespaced by language (`da` / `en`) then category, e.g. `da.destination.togtilab`
 * resolves to `Banedanmark/da/destination/togtilab.mp3`.
 *
 * Assembly order differs per language to match natural grammar; the change-of-track notice
 * (when present) leads the announcement:
 *   Danish:  [notice] → "Toget til X" → "klokken HH MM" → "kører fra spor N" → "om ca. ABC"
 *   English: [notice] → "The HH MM" → "train to X" → "will depart from track N" → "in ABC"
 *
 *   "Bemærk sporændringen. Toget til Aalborg klokken 18 12 kører fra spor 5 om ca. 15-20 minutter"
 *   "Please notice the change of track at this station. The 6 12 train to Aalborg will depart from track 5 in approx. 15-20 min"
 */

/** Delay (ms) inserted before each section for natural pacing. */
const SECTION_DELAY = 300
/** Delay (ms) before switching from the Danish half to the English half. */
const LANGUAGE_DELAY = 2_000

/** Platforms ("spor"/"track") that have recorded audio, in display order. */
const TRACKS: string[] = [...Array.from({ length: 27 }, (_, i) => `${i}`), '1a', '1b', '1c', '2a', '2b', '2c', '3a', '3b', '3c'].sort((a, b) =>
  parseInt(a) - parseInt(b) === 0 ? a.localeCompare(b) : parseInt(a) - parseInt(b),
)

interface ICountdownOption {
  value: string
  title: string
  /** Danish clip ID (within `da.countdown.`) */
  da: string
  /** English clip ID (within `en.countdown.`) */
  en: string
}

/** "Om ca. X minutter" / "in approx. X min" countdown options. */
const COUNTDOWNS: ICountdownOption[] = [
  { value: 'moment', title: 'Om et øjeblik / In a moment', da: 'oejeblik', en: 'amoment' },
  { value: 'few', title: 'Om få minutter / In a few minutes', da: 'faaminutter', en: 'fewminutes' },
  ...[
    '5',
    '6',
    '7',
    '8',
    '9',
    '10',
    '12-15',
    '15-20',
    '20-25',
    '25-30',
    '35',
    '40',
    '45',
    '50',
    '55',
    '60',
    '65',
    '70',
    '75',
    '80',
    '85',
    '90',
  ].map(n => ({ value: `ca${n}min`, title: `Om ca. ${n} min. / In approx. ${n} min`, da: `ca${n}min`, en: `ca${n}min` })),
]

interface IDisruptionOption {
  value: string
  title: string
  da: string
  en: string
}

/** Disruption clips played in place of the countdown. */
const DISRUPTIONS: IDisruptionOption[] = [
  { value: 'awaitstime', title: 'Afventer tid / Awaiting a departure time', da: 'awaitstime', en: 'awaitstime' },
  { value: 'cancelled', title: 'Er desværre aflyst / Has been cancelled', da: 'canceled', en: 'canceled' },
]

interface IBaseAnnouncementOptions {
  /** Ordered list of 1–3 destination station IDs. */
  destinations: string[]
  /** Scheduled departure hour, 24-hour, "0"–"23". */
  hour: string
  /** Scheduled departure minute, "00"–"59". */
  minute: string
}

interface IBanedanmarkAnnouncementOptions extends IBaseAnnouncementOptions {
  track: string
  countdown: string
  /** Lead the announcement with the "change of track" notice. */
  trackChange: boolean
}

interface IDisruptionOptions extends IBaseAnnouncementOptions {
  disruption: string
}

/** Small gap (ms) between destinations when more than one is listed. */
const BETWEEN_DESTINATION_DELAY = 250
const MAX_DESTINATIONS = 3

const HOURS: string[] = Array.from({ length: 24 }, (_, i) => `${i}`)
const MINUTES: string[] = Array.from({ length: 60 }, (_, i) => `${i}`.padStart(2, '0'))

export default class Banedanmark extends StationAnnouncementSystem {
  readonly NAME = 'Banedanmark (Denmark)'
  readonly ID = 'BANEDANMARK_V1'
  readonly FILE_PREFIX = 'Banedanmark'
  readonly SYSTEM_TYPE = 'station'
  readonly DESCRIPTION =
    'Generate bilingual Danish and English platform announcements for the Danish railway network using real Banedanmark station audio recordings.'

  headerComponent() {
    return (
      <p>
        This page generates bilingual Danish and English platform announcements for the Danish railway network using real station audio
        recordings, released on request to Banedanmark in a process known as "Aktindsigt".
      </p>
    )
  }

  /** Danish scheduled-time clips: "klokken {H}" + minute (minute "00" is a 1 ms silence). */
  private timeClipsDa(hour: number, minute: string): AudioItem[] {
    return [`da.hour.kl${hour}`, { id: `da.minute.${minute}`, opts: { delayStart: 75 } }]
  }

  /** English scheduled-time clips. English uses a 12-hour clock: "the {h} oclock" or "the {h}" + minute. */
  private timeClipsEn(hour: number, minute: string): AudioItem[] {
    const h12 = ((hour + 11) % 12) + 1
    if (minute === '00') return [`en.hour.the${h12}oclock`]
    return [`en.hour.the${h12}`, { id: `en.minute.${minute}`, opts: { delayStart: 100 } }]
  }

  /** Inserts a `delayStart` before the first clip of a segment. */
  private section(clips: AudioItem[], delay: number): AudioItem[] {
    return clips.map((clip, i) => {
      if (i !== 0) return clip
      const obj = typeof clip === 'string' ? { id: clip } : { ...clip }
      return { ...obj, opts: { ...obj.opts, delayStart: (obj.opts?.delayStart ?? 0) + delay } }
    })
  }

  /** Joins ordered segments into a clip list, delaying the lead of each segment. */
  private joinSegments(segments: AudioItem[][], leadDelay: number): AudioItem[] {
    return segments.flatMap((seg, i) => this.section(seg, i === 0 ? leadDelay : SECTION_DELAY))
  }

  /**
   * Builds the destination clips for one language.
   *
   * The first stop uses the "Toget til X" / "train to X" clip; any further stops use the bare
   * station-name clip, with the "og" / "and" clip before the last one.
   *   1 stop:  "Toget til X"
   *   2 stops: "Toget til X" "og" "Y"
   *   3 stops: "Toget til X" "Y" "og" "Z"
   */
  private destinationClips(lang: 'da' | 'en', destinations: string[]): AudioItem[] {
    const clips: AudioItem[] = destinations.map((id, i) => {
      const clipId = `${lang}.destination.${i === 0 ? 'togtil' : ''}${id}`
      return i === 0 ? clipId : { id: clipId, opts: { delayStart: BETWEEN_DESTINATION_DELAY } }
    })

    if (clips.length > 1) {
      clips.splice(clips.length - 1, 0, { id: `${lang}.extra.og-and`, opts: { delayStart: BETWEEN_DESTINATION_DELAY } })
    }

    return clips
  }

  /**
   * Builds the full bilingual clip list. Everything up to and including the track is identical
   * between announcement types; `daTail`/`enTail` are the closing clips (countdown, or a
   * disruption clip) and `trackChange` leads each language with the "change of track" notice.
   */
  private buildAnnouncement(
    options: IBaseAnnouncementOptions,
    { daTrailing, enTrailing, trackChange }: { daTrailing: AudioItem[][]; enTrailing: AudioItem[][]; trackChange: boolean },
  ): AudioItem[] {
    const hour = parseInt(options.hour, 10)
    const minute = options.minute
    const destinations = (options.destinations ?? []).filter(Boolean)

    // Danish: [notice] → "Toget til X[, Y og Z]" → time → [track →] tail
    const danish: AudioItem[][] = [this.destinationClips('da', destinations), this.timeClipsDa(hour, minute), ...daTrailing]
    if (trackChange) danish.unshift([`da.extra.trkchg`])

    // English: [notice] → time → "train to X[, Y and Z]" → [track →] tail
    const english: AudioItem[][] = [this.timeClipsEn(hour, minute), this.destinationClips('en', destinations), ...enTrailing]
    if (trackChange) english.unshift([`en.extra.trkchg`])

    return [...this.joinSegments(danish, 0), ...this.joinSegments(english, LANGUAGE_DELAY)]
  }

  private async playAnnouncement(options: IBanedanmarkAnnouncementOptions, download: boolean = false): Promise<void> {
    const countdown = COUNTDOWNS.find(c => c.value === options.countdown) ?? COUNTDOWNS[0]
    const files = this.buildAnnouncement(options, {
      daTrailing: [[`da.track.spor${options.track}`], [`da.countdown.${countdown.da}`]],
      enTrailing: [[`en.track.trk${options.track}`], [`en.countdown.${countdown.en}`]],
      trackChange: options.trackChange,
    })
    await this.playAudioFiles(files, download)
  }

  private async playDisruption(options: IDisruptionOptions, download: boolean = false): Promise<void> {
    const disruption = DISRUPTIONS.find(d => d.value === options.disruption) ?? DISRUPTIONS[0]
    const files = this.buildAnnouncement(options, {
      daTrailing: [[`da.extra.${disruption.da}`]],
      enTrailing: [[`en.extra.${disruption.en}`]],
      trackChange: false,
    })
    await this.playAudioFiles(files, download)
  }

  private static readonly DESTINATION_OPTIONS = Destinations.map(d => ({ title: d.name, value: d.id }))

  private readonly baseOptions = {
    destinations: {
      name: 'Destinations',
      type: 'custom' as const,
      component: BanedanmarkDestinationsPicker,
      props: { options: Banedanmark.DESTINATION_OPTIONS, max: MAX_DESTINATIONS },
      default: [Destinations[0].id],
    },
    hour: {
      name: 'Time of train — hour (24h)',
      default: '18',
      options: HOURS.map(h => ({ title: h, value: h })),
      type: 'select' as const,
    },
    minute: {
      name: 'Time of train — minute',
      default: '12',
      options: MINUTES.map(m => ({ title: m, value: m })),
      type: 'select' as const,
    },
  }

  private readonly announcementOptions = {
    ...this.baseOptions,
    track: {
      name: 'Track (spor)',
      default: '5',
      options: TRACKS.map(t => ({ title: t, value: t })),
      type: 'select' as const,
    },
    countdown: {
      name: 'Time before departure',
      default: 'ca15-20min',
      options: COUNTDOWNS.map(c => ({ title: c.title, value: c.value })),
      type: 'select' as const,
    },
    trackChange: {
      name: 'Track change?',
      default: false,
      type: 'boolean' as const,
    },
  }

  private readonly disruptionOptions = {
    ...this.baseOptions,
    disruption: {
      name: 'Disruption',
      default: 'awaitstime',
      options: DISRUPTIONS.map(d => ({ title: d.title, value: d.value })),
      type: 'select' as const,
    },
  }

  private readonly defaultState: IBanedanmarkAnnouncementOptions = {
    destinations: [Destinations[0].id],
    hour: '18',
    minute: '12',
    track: '5',
    countdown: 'ca15-20min',
    trackChange: false,
  }

  private readonly presets: ICustomAnnouncementPreset[] = [
    {
      name: 'Aarhus H — spor 3 — om ca. 10 min',
      state: { destinations: ['ar'], hour: '14', minute: '30', track: '3', countdown: 'ca10min', trackChange: false },
    },
    {
      name: 'København H — spor 5 — om ca. 5 min',
      state: { destinations: ['kh'], hour: '8', minute: '12', track: '5', countdown: 'ca5min', trackChange: false },
    },
  ]

  private readonly disruptionDefaultState: IDisruptionOptions = {
    destinations: [Destinations[0].id],
    hour: '18',
    minute: '12',
    disruption: 'awaitstime',
  }

  private readonly disruptionPresets: ICustomAnnouncementPreset[] = [
    {
      name: 'Aarhus H — afventer tid',
      state: { destinations: ['ar'], hour: '14', minute: '30', disruption: 'awaitstime' },
    },
    {
      name: 'København H — aflyst',
      state: { destinations: ['kh'], hour: '8', minute: '12', disruption: 'cancelled' },
    },
  ]

  readonly customAnnouncementTabs: Record<string, CustomAnnouncementTab<string>> = {
    announcement: {
      name: 'Platform announcement',
      component: CustomAnnouncementPane,
      defaultState: this.defaultState,
      props: {
        playHandler: this.playAnnouncement.bind(this),
        presets: this.presets,
        options: this.announcementOptions,
      },
    } as CustomAnnouncementTab<keyof IBanedanmarkAnnouncementOptions>,
    disruption: {
      name: 'Disruption',
      component: CustomAnnouncementPane,
      defaultState: this.disruptionDefaultState,
      props: {
        playHandler: this.playDisruption.bind(this),
        presets: this.disruptionPresets,
        options: this.disruptionOptions,
      },
    } as CustomAnnouncementTab<keyof IDisruptionOptions>,
  }
}
