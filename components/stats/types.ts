// ── Dashboard Types & Constants ────────────────────────────────
export interface DayStats {
    date: string
    bookings: number
    couverts: number
    walkins: number
    noShows: number
    cancellations: number
    arrived: number
    revenue: number | null
    revenueNotes: string | null
}

export interface PrevDayStats {
    date: string
    bookings: number
    couverts: number
}

export interface HeatmapCell { dow: number; hour: number; count: number }

export interface TableUtil {
    id: string; name: string; seats: number; zone: string
    booking_count: number; total_guests: number
}

export interface Comparison {
    bookings: number; couverts: number; walkins: number
    no_shows: number; cancellations: number; revenue: number
}

export interface Summary {
    bookings: number; couverts: number; revenue: number; avgPerDay: number
    walkins: number; noShows: number; cancellations: number
    noShowRate: number; cancRate: number; occupancy: number; revpash: number; activeDays: number
}

export interface ExtraStats {
    avgPartySize: number
    busiestDay: string | null
    peakHours: { hour: number; count: number }[]
    activeDays: number
}

export interface RevenueData { total: number; avg_per_couvert: number }

export type Tab = 'overzicht' | 'dagelijks' | 'analyse'
export type ChartMetric = 'couverts' | 'bookings' | 'revenue'
export type DatePreset = '7d' | '30d' | 'week' | 'prev_week' | 'month' | 'prev_month'

export interface DashboardState {
    tab: Tab
    preset: DatePreset
    dateRange: { from: string; to: string }
    chartMetric: ChartMetric
    selectedDay: DayStats | null
    editingRevenue: string | null
    revenueInput: string
    sortCol: string
    sortDir: 'asc' | 'desc'
}

// ── Constants ──────────────────────────────────────────────────
export const ACCENT = '#2563eb'
export const ACCENT_LIGHT = '#dbeafe'
export const SERVICE_HOURS = 11 // TODO: move to restaurant config

export const METRIC_DEFINITIONS: Record<string, { label: string; formula: string; includes: string; excludes: string }> = {
    occupancy: {
        label: 'Bezetting',
        formula: 'Couverts ÷ (Totaal stoelen × Actieve dagen)',
        includes: 'Alle gearriveerde en verwachte gasten',
        excludes: 'Geen rekening met meerdere seatings per avond'
    },
    revpash: {
        label: 'RevPASH',
        formula: 'Omzet ÷ (Stoelen × Dagen × Serviceuren)',
        includes: 'Handmatig ingevoerde omzet, alle stoelen',
        excludes: 'Geen uitsplitsing lunch/diner'
    },
    repeatRate: {
        label: 'Herhaalbezoek',
        formula: 'Gasten met >1 boeking ÷ Totaal unieke gasten',
        includes: 'Op basis van e-mailadres (genormaliseerd)',
        excludes: 'Gasten zonder e-mail, walk-ins zonder registratie'
    },
    noShowRate: {
        label: 'No-show rate',
        formula: 'No-shows ÷ Totaal boekingen × 100',
        includes: 'Alle boekingen met status "no_show"',
        excludes: 'Geannuleerde boekingen'
    },
    cancRate: {
        label: 'Annuleringspercentage',
        formula: 'Annuleringen ÷ Totaal boekingen × 100',
        includes: 'Alle boekingen met status "cancelled"',
        excludes: 'No-shows (apart geteld)'
    },
    avgSpend: {
        label: 'Gem. besteding',
        formula: 'Totaal omzet ÷ Totaal couverts',
        includes: 'Handmatige omzet invoer per dag',
        excludes: 'Dagen zonder omzet ingevoerd'
    }
}
