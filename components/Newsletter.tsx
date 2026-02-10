import React, { useState, useEffect } from 'react'
import { Mail, Send, Users, ChevronLeft, CheckCircle, AlertCircle, Search } from 'lucide-react'
import { API_BASE_URL, RESTAURANT_ID } from '../api'

type Subscriber = {
    id: string
    name: string
    email: string
    phone?: string
    newsletter_opt_in: boolean
    total_visits?: number
    last_visit?: string
    created_at: string
}

type SubscriberData = {
    total: number
    opted_in: number
    opted_out: number
    subscribers: Subscriber[]
}

export function Newsletter({ restaurantId }: { restaurantId: string }) {
    const [data, setData] = useState<SubscriberData | null>(null)
    const [loading, setLoading] = useState(true)
    const [search, setSearch] = useState('')
    const [showComposer, setShowComposer] = useState(false)
    const [subject, setSubject] = useState('')
    const [message, setMessage] = useState('')
    const [sendToAll, setSendToAll] = useState(false)
    const [sending, setSending] = useState(false)
    const [sendResult, setSendResult] = useState<{ success: boolean; sent: number; failed: number } | null>(null)

    useEffect(() => {
        loadSubscribers()
    }, [])

    const loadSubscribers = async () => {
        try {
            const token = localStorage.getItem('events_token')
            const res = await fetch(`${API_BASE_URL}/api/admin/newsletter/subscribers?restaurantId=${restaurantId}`, {
                headers: { 'Authorization': `Bearer ${token}` }
            })
            if (res.ok) {
                const json = await res.json()
                setData(json)
            }
        } catch (e) {
            console.error('Failed to load subscribers:', e)
        } finally {
            setLoading(false)
        }
    }

    const handleSend = async () => {
        if (!subject.trim() || !message.trim()) return
        setSending(true)
        setSendResult(null)
        try {
            const token = localStorage.getItem('events_token')
            const res = await fetch(`${API_BASE_URL}/api/admin/newsletter/send`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`
                },
                body: JSON.stringify({
                    restaurantId,
                    subject: subject.trim(),
                    message: message.trim(),
                    sendToAll
                })
            })
            if (res.ok) {
                const result = await res.json()
                setSendResult(result)
            }
        } catch (e) {
            console.error('Failed to send newsletter:', e)
            setSendResult({ success: false, sent: 0, failed: 0 })
        } finally {
            setSending(false)
        }
    }

    const filtered = data?.subscribers.filter(s =>
        s.name?.toLowerCase().includes(search.toLowerCase()) ||
        s.email?.toLowerCase().includes(search.toLowerCase())
    ) || []

    if (loading) {
        return (
            <div className="flex items-center justify-center h-64">
                <div className="animate-spin w-8 h-8 border-2 border-emerald-500 border-t-transparent rounded-full" />
            </div>
        )
    }

    return (
        <div className="max-w-4xl mx-auto px-4 py-6 space-y-6">
            {/* Header */}
            <div className="flex items-center justify-between">
                <div>
                    <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
                        <Mail className="w-6 h-6 text-emerald-600" />
                        Nieuwsbrief
                    </h1>
                    <p className="text-sm text-gray-500 mt-1">
                        Beheer je mailinglijst en stuur promotionele emails
                    </p>
                </div>
                <button
                    onClick={() => { setShowComposer(!showComposer); setSendResult(null) }}
                    className="px-4 py-2 bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 transition-colors flex items-center gap-2 font-medium"
                >
                    <Send className="w-4 h-4" />
                    Nieuwe email
                </button>
            </div>

            {/* Stats Cards */}
            {data && (
                <div className="grid grid-cols-3 gap-4">
                    <div className="bg-white rounded-xl border border-gray-200 p-4">
                        <div className="flex items-center gap-2 text-gray-600 mb-1">
                            <Users className="w-4 h-4" />
                            <span className="text-xs font-medium">Totaal</span>
                        </div>
                        <div className="text-2xl font-bold text-gray-900">{data.total}</div>
                        <div className="text-xs text-gray-500 mt-1">email adressen</div>
                    </div>
                    <div className="bg-white rounded-xl border border-gray-200 p-4">
                        <div className="flex items-center gap-2 text-emerald-600 mb-1">
                            <CheckCircle className="w-4 h-4" />
                            <span className="text-xs font-medium">Opt-in</span>
                        </div>
                        <div className="text-2xl font-bold text-emerald-700">{data.opted_in}</div>
                        <div className="text-xs text-emerald-500 mt-1">nieuwsbrief abonnees</div>
                    </div>
                    <div className="bg-white rounded-xl border border-gray-200 p-4">
                        <div className="flex items-center gap-2 text-gray-400 mb-1">
                            <AlertCircle className="w-4 h-4" />
                            <span className="text-xs font-medium">Opt-out</span>
                        </div>
                        <div className="text-2xl font-bold text-gray-500">{data.opted_out}</div>
                        <div className="text-xs text-gray-400 mt-1">geen nieuwsbrief</div>
                    </div>
                </div>
            )}

            {/* Email Composer */}
            {showComposer && (
                <div className="bg-white rounded-xl border border-gray-200 p-6 space-y-4">
                    <h2 className="text-lg font-semibold text-gray-900">📧 Nieuwe email schrijven</h2>

                    {sendResult ? (
                        <div className={`rounded-lg p-4 ${sendResult.success ? 'bg-emerald-50 text-emerald-800' : 'bg-red-50 text-red-800'}`}>
                            {sendResult.success ? (
                                <div className="flex items-center gap-2">
                                    <CheckCircle className="w-5 h-5 text-emerald-600" />
                                    <span className="font-medium">Verstuurd! {sendResult.sent} emails bezorgd{sendResult.failed > 0 ? `, ${sendResult.failed} mislukt` : ''}.</span>
                                </div>
                            ) : (
                                <div className="flex items-center gap-2">
                                    <AlertCircle className="w-5 h-5 text-red-600" />
                                    <span className="font-medium">Er is iets misgegaan. Probeer opnieuw.</span>
                                </div>
                            )}
                        </div>
                    ) : (
                        <>
                            <div>
                                <label className="block text-sm font-medium text-gray-700 mb-1">Onderwerp</label>
                                <input
                                    type="text"
                                    value={subject}
                                    onChange={e => setSubject(e.target.value)}
                                    placeholder="bv. Speciale kerst menu 🎄"
                                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500"
                                />
                            </div>

                            <div>
                                <label className="block text-sm font-medium text-gray-700 mb-1">Bericht</label>
                                <textarea
                                    value={message}
                                    onChange={e => setMessage(e.target.value)}
                                    rows={6}
                                    placeholder="Schrijf hier je promotionele bericht..."
                                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 resize-none"
                                />
                                <p className="text-xs text-gray-400 mt-1">Dit bericht wordt automatisch opgemaakt in de De Tafelaar huisstijl.</p>
                            </div>

                            <div className="flex items-center gap-2">
                                <input
                                    type="checkbox"
                                    id="sendToAll"
                                    checked={sendToAll}
                                    onChange={e => setSendToAll(e.target.checked)}
                                    className="rounded border-gray-300 text-emerald-600 focus:ring-emerald-500"
                                />
                                <label htmlFor="sendToAll" className="text-sm text-gray-600">
                                    Stuur naar <strong>alle</strong> klanten (ook zonder opt-in)
                                </label>
                            </div>

                            <div className="flex items-center justify-between pt-2">
                                <span className="text-sm text-gray-500">
                                    Ontvangers: <strong className="text-gray-900">{sendToAll ? data?.total : data?.opted_in}</strong> personen
                                </span>
                                <div className="flex gap-2">
                                    <button
                                        onClick={() => setShowComposer(false)}
                                        className="px-4 py-2 text-gray-600 hover:bg-gray-100 rounded-lg transition-colors"
                                    >
                                        Annuleren
                                    </button>
                                    <button
                                        onClick={handleSend}
                                        disabled={sending || !subject.trim() || !message.trim()}
                                        className="px-6 py-2 bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 transition-colors flex items-center gap-2 font-medium disabled:opacity-50 disabled:cursor-not-allowed"
                                    >
                                        {sending ? (
                                            <>
                                                <div className="animate-spin w-4 h-4 border-2 border-white border-t-transparent rounded-full" />
                                                Versturen...
                                            </>
                                        ) : (
                                            <>
                                                <Send className="w-4 h-4" />
                                                Versturen
                                            </>
                                        )}
                                    </button>
                                </div>
                            </div>
                        </>
                    )}
                </div>
            )}

            {/* Subscriber List */}
            <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
                <div className="p-4 border-b border-gray-200">
                    <div className="flex items-center gap-2">
                        <Search className="w-4 h-4 text-gray-400" />
                        <input
                            type="text"
                            value={search}
                            onChange={e => setSearch(e.target.value)}
                            placeholder="Zoek op naam of email..."
                            className="flex-1 text-sm border-none outline-none"
                        />
                    </div>
                </div>

                <table className="w-full text-sm">
                    <thead className="bg-gray-50">
                        <tr>
                            <th className="px-4 py-2 text-left font-medium text-gray-600">Naam</th>
                            <th className="px-4 py-2 text-left font-medium text-gray-600">Email</th>
                            <th className="px-4 py-2 text-center font-medium text-gray-600">Opt-in</th>
                            <th className="px-4 py-2 text-right font-medium text-gray-600">Bezoeken</th>
                            <th className="px-4 py-2 text-right font-medium text-gray-600">Laatste bezoek</th>
                        </tr>
                    </thead>
                    <tbody>
                        {filtered.length === 0 ? (
                            <tr>
                                <td colSpan={5} className="px-4 py-8 text-center text-gray-400">
                                    {search ? 'Geen resultaten gevonden' : 'Nog geen klanten met email'}
                                </td>
                            </tr>
                        ) : (
                            filtered.map((sub, i) => (
                                <tr key={sub.id} className={`${i % 2 === 0 ? 'bg-white' : 'bg-gray-50'} hover:bg-emerald-50 transition-colors`}>
                                    <td className="px-4 py-2 text-gray-900 font-medium">{sub.name || '-'}</td>
                                    <td className="px-4 py-2 text-blue-600">
                                        <a href={`mailto:${sub.email}`}>{sub.email}</a>
                                    </td>
                                    <td className="px-4 py-2 text-center">
                                        {sub.newsletter_opt_in ? (
                                            <span className="inline-flex items-center gap-1 text-emerald-600 text-xs font-medium bg-emerald-50 px-2 py-0.5 rounded-full">
                                                <CheckCircle className="w-3 h-3" /> Ja
                                            </span>
                                        ) : (
                                            <span className="text-gray-400 text-xs">Nee</span>
                                        )}
                                    </td>
                                    <td className="px-4 py-2 text-right text-gray-600">{sub.total_visits || 0}</td>
                                    <td className="px-4 py-2 text-right text-gray-500 text-xs">
                                        {sub.last_visit ? new Date(sub.last_visit).toLocaleDateString('nl-NL') : '-'}
                                    </td>
                                </tr>
                            ))
                        )}
                    </tbody>
                </table>
            </div>
        </div>
    )
}
