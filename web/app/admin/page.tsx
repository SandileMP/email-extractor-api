'use client'
import { useEffect, useState, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/utils/supabase/client'

const API = 'https://ebfczvv0p2.execute-api.eu-west-1.amazonaws.com'

// ── Types ─────────────────────────────────────────────────────────────────

interface Overview {
  total_users: number; active_subs: number; active_keys: number
  mrr_zar: number; new_this_week: number
  total_extractions: number; total_seo_scans: number; total_campaigns: number
}
interface AdminUser {
  user_id: string; email: string; created_at: string; confirmed: boolean
  role: string; sub_status: string; has_key: boolean; key_active: boolean
  api_key_prefix: string | null
}
interface Revenue {
  mrr_zar: number; active_subs: number; plan_name: string
  plan_amount_zar: number; total_revenue_30d: number
  recent_transactions: { reference: string; amount_zar: number; email: string; paid_at: string; status: string }[]
}
interface Campaign {
  campaign_id: string; user_id: string; name: string; status: string
  subject: string; recipient_count: number; sent_count: number
  bounced_count: number; failed_count: number; created_at: string
}
interface UsageRow {
  user_id: string; extractions: number; seo_scans: number
  campaigns: number; emails_sent: number
}

// ── Small components ──────────────────────────────────────────────────────

function StatCard({ label, value, sub, color = 'emerald' }: {
  label: string; value: string | number; sub?: string; color?: string
}) {
  const colors: Record<string, string> = {
    emerald: 'text-emerald-400', cyan: 'text-cyan-400',
    yellow: 'text-yellow-400', purple: 'text-purple-400', red: 'text-red-400',
  }
  return (
    <div className="rounded-xl border border-white/5 p-5" style={{ background: '#0d0f1a' }}>
      <p className="text-[10px] text-zinc-500 uppercase tracking-widest mb-2">{label}</p>
      <p className={`text-3xl font-black ${colors[color] || colors.emerald}`}>{value}</p>
      {sub && <p className="text-xs text-zinc-600 mt-1">{sub}</p>}
    </div>
  )
}

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, string> = {
    active:   'bg-emerald-500/10 border-emerald-500/30 text-emerald-400',
    inactive: 'bg-zinc-800 border-zinc-700 text-zinc-500',
    none:     'bg-zinc-800 border-zinc-700 text-zinc-600',
    draft:    'bg-zinc-800 border-zinc-700 text-zinc-400',
    queued:   'bg-blue-500/10 border-blue-500/30 text-blue-400',
    sending:  'bg-yellow-500/10 border-yellow-500/30 text-yellow-400',
    sent:     'bg-emerald-500/10 border-emerald-500/30 text-emerald-400',
    failed:   'bg-red-500/10 border-red-500/30 text-red-400',
  }
  return (
    <span className={`text-[10px] font-bold uppercase px-2 py-0.5 rounded-full border ${map[status] || map.none}`}>
      {status}
    </span>
  )
}

// ── Main ──────────────────────────────────────────────────────────────────

export default function AdminPage() {
  const router  = useRouter()
  const [apiKey, setApiKey]         = useState<string | null>(null)
  const [loading, setLoading]       = useState(true)
  const [tab, setTab]               = useState<'overview' | 'users' | 'revenue' | 'campaigns' | 'usage'>('overview')
  const [toast, setToast]           = useState<{ msg: string; type: 'success' | 'error' } | null>(null)

  // Data
  const [overview, setOverview]     = useState<Overview | null>(null)
  const [users, setUsers]           = useState<AdminUser[]>([])
  const [userTotal, setUserTotal]   = useState(0)
  const [userSearch, setUserSearch] = useState('')
  const [revenue, setRevenue]       = useState<Revenue | null>(null)
  const [campaigns, setCampaigns]   = useState<Campaign[]>([])
  const [usage, setUsage]           = useState<UsageRow[]>([])
  const [dataLoading, setDataLoading] = useState(false)

  // User detail modal
  const [selectedUser, setSelectedUser] = useState<AdminUser | null>(null)
  const [userDetail, setUserDetail]     = useState<Record<string, unknown> | null>(null)
  const [actionLoading, setActionLoading] = useState(false)

  function showToast(msg: string, type: 'success' | 'error' = 'success') {
    setToast({ msg, type })
    setTimeout(() => setToast(null), 4000)
  }

  // Auth gate — must be super_admin
  useEffect(() => {
    const supabase = createClient()
    async function gate() {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session) { router.push('/login'); return }

      const { data: { user } } = await supabase.auth.getUser()
      if (user?.app_metadata?.role !== 'super_admin') {
        router.push('/dashboard')
        return
      }

      const { data: keys } = await supabase
        .from('api_keys').select('api_key')
        .eq('user_id', session.user.id).eq('active', true).limit(1)
      setApiKey(keys?.[0]?.api_key ?? null)
      setLoading(false)
    }
    gate()
  }, [router])

  const apiFetch = useCallback(async (path: string, opts?: RequestInit) => {
    if (!apiKey) return null
    const res = await fetch(`${API}${path}`, {
      ...opts,
      headers: { 'X-API-Key': apiKey, 'Content-Type': 'application/json', ...opts?.headers },
    })
    return res.json()
  }, [apiKey])

  // Load data when tab changes
  useEffect(() => {
    if (!apiKey || loading) return
    setDataLoading(true)
    const load = async () => {
      if (tab === 'overview') {
        const d = await apiFetch('/admin/overview')
        if (d && !d.error) setOverview(d)
      } else if (tab === 'users') {
        const d = await apiFetch(`/admin/users?limit=100${userSearch ? `&search=${encodeURIComponent(userSearch)}` : ''}`)
        if (d && !d.error) { setUsers(d.users || []); setUserTotal(d.total || 0) }
      } else if (tab === 'revenue') {
        const d = await apiFetch('/admin/revenue')
        if (d && !d.error) setRevenue(d)
      } else if (tab === 'campaigns') {
        const d = await apiFetch('/admin/campaigns?limit=100')
        if (d && !d.error) setCampaigns(d.campaigns || [])
      } else if (tab === 'usage') {
        const d = await apiFetch('/admin/usage')
        if (d && !d.error) setUsage(d.usage || [])
      }
      setDataLoading(false)
    }
    load()
  }, [tab, apiKey, loading, apiFetch, userSearch])

  async function loadUserDetail(user: AdminUser) {
    setSelectedUser(user)
    setUserDetail(null)
    const d = await apiFetch(`/admin/users/${user.user_id}`)
    if (d && !d.error) setUserDetail(d)
  }

  async function revokeKey(userId: string, active: boolean) {
    setActionLoading(true)
    const d = await apiFetch(`/admin/users/${userId}/key`, {
      method: 'PATCH', body: JSON.stringify({ active }),
    })
    if (d?.error) showToast(d.error, 'error')
    else {
      showToast(active ? 'API key restored' : 'API key revoked')
      setUsers(u => u.map(x => x.user_id === userId ? { ...x, key_active: active } : x))
      if (selectedUser?.user_id === userId) setSelectedUser(s => s ? { ...s, key_active: active } : s)
    }
    setActionLoading(false)
  }

  async function setSubStatus(userId: string, status: string) {
    setActionLoading(true)
    const d = await apiFetch(`/admin/users/${userId}/subscription`, {
      method: 'PATCH', body: JSON.stringify({ status }),
    })
    if (d?.error) showToast(d.error, 'error')
    else {
      showToast(`Subscription set to ${status}`)
      setUsers(u => u.map(x => x.user_id === userId ? { ...x, sub_status: status } : x))
    }
    setActionLoading(false)
  }

  async function deleteUser(user: AdminUser) {
    if (!confirm(`Permanently delete ${user.email} and all their data? This cannot be undone.`)) return
    setActionLoading(true)
    const d = await apiFetch(`/admin/users/${user.user_id}`, { method: 'DELETE' })
    if (d?.error) showToast(d.error, 'error')
    else {
      showToast(`${user.email} deleted`)
      setUsers(u => u.filter(x => x.user_id !== user.user_id))
      setSelectedUser(null); setUserDetail(null)
    }
    setActionLoading(false)
  }

  if (loading) return (
    <div className="min-h-screen flex items-center justify-center" style={{ background: '#07080f' }}>
      <div className="w-8 h-8 rounded-full border-2 border-emerald-500 border-t-transparent animate-spin" />
    </div>
  )

  const TABS = [
    { id: 'overview',  label: 'Overview'  },
    { id: 'users',     label: 'Users'     },
    { id: 'revenue',   label: 'Revenue'   },
    { id: 'campaigns', label: 'Campaigns' },
    { id: 'usage',     label: 'Usage'     },
  ]

  return (
    <div className="min-h-screen" style={{ background: '#07080f' }}>

      {/* Toast */}
      {toast && (
        <div className={`fixed top-5 right-5 z-50 px-5 py-3 rounded-xl text-sm font-semibold shadow-2xl border ${
          toast.type === 'success' ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-300'
                                   : 'bg-red-500/10 border-red-500/30 text-red-300'
        }`}>{toast.type === 'success' ? '✓ ' : '✕ '}{toast.msg}</div>
      )}

      {/* Nav */}
      <nav className="border-b border-white/5 sticky top-0 z-40 backdrop-blur-xl" style={{ background: '#07080f99' }}>
        <div className="max-w-7xl mx-auto px-6 h-14 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <Link href="/dashboard" className="text-zinc-500 hover:text-white transition-colors text-xs">← Dashboard</Link>
            <span className="text-zinc-700 text-xs">|</span>
            <div className="flex items-center gap-2">
              <span className="text-xs font-bold px-2 py-0.5 rounded bg-red-500/10 border border-red-500/30 text-red-400">
                SUPER ADMIN
              </span>
              <span className="font-bold text-sm">Weblandr</span>
            </div>
          </div>
          <div className="flex gap-1 p-0.5 rounded-lg" style={{ background: '#0d0f1a' }}>
            {TABS.map(t => (
              <button key={t.id} onClick={() => setTab(t.id as typeof tab)}
                className={`px-4 py-1.5 rounded text-xs font-semibold transition-all ${
                  tab === t.id ? 'bg-white/10 text-white' : 'text-zinc-500 hover:text-zinc-300'
                }`}>{t.label}</button>
            ))}
          </div>
        </div>
      </nav>

      <main className="max-w-7xl mx-auto px-6 py-8">
        <div className="flex items-center justify-between mb-6">
          <h1 className="text-xl font-bold">Admin Panel</h1>
          {dataLoading && <div className="w-4 h-4 border-2 border-emerald-500 border-t-transparent rounded-full animate-spin"/>}
        </div>

        {/* ── OVERVIEW ─────────────────────────────────────────────── */}
        {tab === 'overview' && overview && (
          <div className="space-y-6">
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
              <StatCard label="Total users"       value={overview.total_users}         sub="All registered accounts" />
              <StatCard label="Active subscribers" value={overview.active_subs}         sub="Paying customers" color="cyan" />
              <StatCard label="MRR"               value={`R${overview.mrr_zar.toLocaleString()}`} sub="Monthly recurring revenue" color="yellow" />
              <StatCard label="New this week"     value={overview.new_this_week}        sub="New signups (7d)" color="purple" />
            </div>
            <div className="grid grid-cols-3 gap-4">
              <StatCard label="Total extractions" value={overview.total_extractions} color="emerald" />
              <StatCard label="SEO scans"         value={overview.total_seo_scans}   color="cyan"    />
              <StatCard label="Campaigns created" value={overview.total_campaigns}   color="purple"  />
            </div>
            <div className="rounded-xl border border-white/5 p-6" style={{ background: '#0d0f1a' }}>
              <h2 className="text-xs font-semibold text-zinc-500 uppercase tracking-wider mb-4">Quick actions</h2>
              <div className="flex flex-wrap gap-3">
                {TABS.filter(t => t.id !== 'overview').map(t => (
                  <button key={t.id} onClick={() => setTab(t.id as typeof tab)}
                    className="text-sm px-4 py-2 rounded-lg border border-white/10 hover:bg-white/5 text-zinc-300 transition-colors">
                    View {t.label} →
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* ── USERS ────────────────────────────────────────────────── */}
        {tab === 'users' && (
          <div className="space-y-4">
            <div className="flex items-center gap-3">
              <input value={userSearch} onChange={e => setUserSearch(e.target.value)}
                placeholder="Search by email…"
                className="flex-1 max-w-sm px-4 py-2 rounded-xl text-sm outline-none"
                style={{ background: '#0d0f1a', border: '1px solid #ffffff10', color: 'white' }}/>
              <span className="text-xs text-zinc-600">{userTotal} users total</span>
            </div>

            <div className="rounded-xl border border-white/5 overflow-hidden" style={{ background: '#0d0f1a' }}>
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-white/5 text-left">
                    {['Email', 'Joined', 'Confirmed', 'Subscription', 'API Key', 'Actions'].map(h => (
                      <th key={h} className="px-4 py-3 text-[10px] text-zinc-500 font-semibold uppercase tracking-wider">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/5">
                  {users.map(u => (
                    <tr key={u.user_id} className="hover:bg-white/[0.02] transition-colors">
                      <td className="px-4 py-3">
                        <button onClick={() => loadUserDetail(u)}
                          className="text-left hover:text-emerald-400 transition-colors">
                          <p className="font-medium text-zinc-200">{u.email}</p>
                          {u.role === 'super_admin' && (
                            <span className="text-[9px] text-red-400 font-bold uppercase">super_admin</span>
                          )}
                        </button>
                      </td>
                      <td className="px-4 py-3 text-xs text-zinc-500">
                        {new Date(u.created_at).toLocaleDateString()}
                      </td>
                      <td className="px-4 py-3">
                        <span className={`text-[10px] font-bold ${u.confirmed ? 'text-emerald-400' : 'text-zinc-600'}`}>
                          {u.confirmed ? '✓' : '✗'}
                        </span>
                      </td>
                      <td className="px-4 py-3"><StatusBadge status={u.sub_status} /></td>
                      <td className="px-4 py-3">
                        {u.has_key ? (
                          <span className={`text-[10px] font-bold ${u.key_active ? 'text-emerald-400' : 'text-red-400'}`}>
                            {u.key_active ? '● Active' : '○ Revoked'}
                          </span>
                        ) : <span className="text-zinc-600 text-[10px]">None</span>}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-1.5">
                          {u.has_key && (
                            <button
                              onClick={() => revokeKey(u.user_id, !u.key_active)}
                              disabled={actionLoading}
                              className={`text-[10px] px-2 py-1 rounded border transition-colors disabled:opacity-50 ${
                                u.key_active
                                  ? 'border-red-500/20 text-red-400 hover:bg-red-500/10'
                                  : 'border-emerald-500/20 text-emerald-400 hover:bg-emerald-500/10'
                              }`}>
                              {u.key_active ? 'Revoke key' : 'Restore key'}
                            </button>
                          )}
                          <button
                            onClick={() => setSubStatus(u.user_id, u.sub_status === 'active' ? 'inactive' : 'active')}
                            disabled={actionLoading || u.role === 'super_admin'}
                            className="text-[10px] px-2 py-1 rounded border border-white/10 text-zinc-400 hover:bg-white/5 transition-colors disabled:opacity-30">
                            {u.sub_status === 'active' ? 'Deactivate' : 'Activate'}
                          </button>
                          {u.role !== 'super_admin' && (
                            <button
                              onClick={() => deleteUser(u)}
                              disabled={actionLoading}
                              className="text-[10px] px-2 py-1 rounded border border-red-500/20 text-red-500 hover:bg-red-500/10 transition-colors disabled:opacity-50">
                              Delete
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                  {users.length === 0 && !dataLoading && (
                    <tr><td colSpan={6} className="px-4 py-8 text-center text-zinc-600 text-sm">No users found</td></tr>
                  )}
                </tbody>
              </table>
            </div>

            {/* User detail slide-over */}
            {selectedUser && (
              <div className="rounded-xl border border-white/10" style={{ background: '#0a0c14' }}>
                <div className="flex items-center justify-between px-5 py-3 border-b border-white/5">
                  <p className="font-semibold text-sm">{selectedUser.email}</p>
                  <button onClick={() => { setSelectedUser(null); setUserDetail(null) }}
                    className="text-zinc-500 hover:text-white transition-colors text-lg leading-none">×</button>
                </div>
                {!userDetail ? (
                  <div className="flex justify-center py-8">
                    <div className="w-5 h-5 border-2 border-emerald-500 border-t-transparent rounded-full animate-spin"/>
                  </div>
                ) : (
                  <div className="p-5 grid sm:grid-cols-3 gap-6">
                    <div>
                      <p className="text-[10px] text-zinc-500 uppercase tracking-wider mb-2">Subscription</p>
                      {(userDetail.subscription as Record<string,unknown>) ? (
                        <div className="space-y-1 text-xs text-zinc-300">
                          <p>Status: <StatusBadge status={(userDetail.subscription as Record<string,unknown>).status as string}/></p>
                          <p className="font-mono text-zinc-500 text-[10px] mt-1">
                            {(userDetail.subscription as Record<string,unknown>).subscription_code as string}
                          </p>
                        </div>
                      ) : <p className="text-xs text-zinc-600">No subscription</p>}
                    </div>
                    <div>
                      <p className="text-[10px] text-zinc-500 uppercase tracking-wider mb-2">Usage</p>
                      <div className="space-y-1 text-xs">
                        {[
                          ['Extractions', (userDetail.usage as Record<string,unknown>)?.extractions],
                          ['SEO scans',   (userDetail.usage as Record<string,unknown>)?.seo_scans],
                          ['Campaigns',   (userDetail.usage as Record<string,unknown>)?.campaigns],
                        ].map(([label, val]) => (
                          <div key={label as string} className="flex justify-between">
                            <span className="text-zinc-500">{label as string}</span>
                            <span className="font-bold text-zinc-200">{val as number}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                    <div>
                      <p className="text-[10px] text-zinc-500 uppercase tracking-wider mb-2">API Keys</p>
                      <div className="space-y-1">
                        {((userDetail.api_keys as Array<Record<string,unknown>>) || []).map((k, i) => (
                          <div key={i} className="flex items-center gap-2">
                            <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${k.active ? 'bg-emerald-400' : 'bg-zinc-600'}`}/>
                            <span className="text-[10px] font-mono text-zinc-400 truncate">{k.api_key as string}</span>
                          </div>
                        ))}
                        {!(userDetail.api_keys as unknown[])?.length && <p className="text-xs text-zinc-600">No keys</p>}
                      </div>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* ── REVENUE ──────────────────────────────────────────────── */}
        {tab === 'revenue' && revenue && (
          <div className="space-y-6">
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
              <StatCard label="MRR"              value={`R${revenue.mrr_zar.toLocaleString()}`}        color="yellow" />
              <StatCard label="Active subscribers" value={revenue.active_subs}                          color="emerald" />
              <StatCard label="Revenue (30d)"    value={`R${revenue.total_revenue_30d.toFixed(0)}`}     color="cyan" />
              <StatCard label="Plan price"       value={`R${revenue.plan_amount_zar}`}                 sub={revenue.plan_name} />
            </div>

            <div className="rounded-xl border border-white/5 overflow-hidden" style={{ background: '#0d0f1a' }}>
              <div className="px-5 py-3 border-b border-white/5">
                <h2 className="text-xs font-semibold text-zinc-500 uppercase tracking-wider">Recent transactions (30 days)</h2>
              </div>
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-white/5">
                    {['Email', 'Amount', 'Date', 'Status', 'Reference'].map(h => (
                      <th key={h} className="px-4 py-2.5 text-left text-[10px] text-zinc-500 font-semibold uppercase tracking-wider">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/5">
                  {revenue.recent_transactions.map(t => (
                    <tr key={t.reference} className="hover:bg-white/[0.02]">
                      <td className="px-4 py-2.5 text-zinc-300">{t.email}</td>
                      <td className="px-4 py-2.5 text-emerald-400 font-semibold">R{t.amount_zar.toFixed(2)}</td>
                      <td className="px-4 py-2.5 text-zinc-500 text-xs">{new Date(t.paid_at).toLocaleDateString()}</td>
                      <td className="px-4 py-2.5"><StatusBadge status={t.status}/></td>
                      <td className="px-4 py-2.5 text-zinc-600 text-xs font-mono">{t.reference}</td>
                    </tr>
                  ))}
                  {revenue.recent_transactions.length === 0 && (
                    <tr><td colSpan={5} className="px-4 py-8 text-center text-zinc-600 text-sm">No transactions in last 30 days</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* ── CAMPAIGNS ────────────────────────────────────────────── */}
        {tab === 'campaigns' && (
          <div className="rounded-xl border border-white/5 overflow-hidden" style={{ background: '#0d0f1a' }}>
            <div className="px-5 py-3 border-b border-white/5 flex items-center justify-between">
              <h2 className="text-xs font-semibold text-zinc-500 uppercase tracking-wider">All campaigns — {campaigns.length} total</h2>
            </div>
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-white/5">
                  {['User', 'Campaign', 'Status', 'Recipients', 'Sent', 'Bounced', 'Created'].map(h => (
                    <th key={h} className="px-4 py-2.5 text-left text-[10px] text-zinc-500 font-semibold uppercase tracking-wider">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5">
                {campaigns.map(c => (
                  <tr key={c.campaign_id} className="hover:bg-white/[0.02]">
                    <td className="px-4 py-2.5 text-zinc-500 text-xs truncate max-w-[140px]">{c.user_id}</td>
                    <td className="px-4 py-2.5">
                      <p className="text-zinc-200 font-medium truncate max-w-[180px]">{c.name}</p>
                      <p className="text-zinc-600 text-xs truncate max-w-[180px]">{c.subject}</p>
                    </td>
                    <td className="px-4 py-2.5"><StatusBadge status={c.status}/></td>
                    <td className="px-4 py-2.5 text-zinc-300">{c.recipient_count}</td>
                    <td className="px-4 py-2.5 text-emerald-400 font-semibold">{c.sent_count}</td>
                    <td className="px-4 py-2.5 text-red-400">{c.bounced_count}</td>
                    <td className="px-4 py-2.5 text-zinc-500 text-xs">{new Date(c.created_at).toLocaleDateString()}</td>
                  </tr>
                ))}
                {campaigns.length === 0 && !dataLoading && (
                  <tr><td colSpan={7} className="px-4 py-8 text-center text-zinc-600 text-sm">No campaigns yet</td></tr>
                )}
              </tbody>
            </table>
          </div>
        )}

        {/* ── USAGE ────────────────────────────────────────────────── */}
        {tab === 'usage' && (
          <div className="rounded-xl border border-white/5 overflow-hidden" style={{ background: '#0d0f1a' }}>
            <div className="px-5 py-3 border-b border-white/5">
              <h2 className="text-xs font-semibold text-zinc-500 uppercase tracking-wider">
                Per-user consumption — {usage.length} active users
              </h2>
            </div>
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-white/5">
                  {['Rank', 'User', 'Extractions', 'SEO Scans', 'Campaigns', 'Emails sent', 'Total actions'].map(h => (
                    <th key={h} className="px-4 py-2.5 text-left text-[10px] text-zinc-500 font-semibold uppercase tracking-wider">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5">
                {usage.map((u, i) => {
                  const total = u.extractions + u.seo_scans + u.campaigns
                  return (
                    <tr key={u.user_id} className="hover:bg-white/[0.02]">
                      <td className="px-4 py-2.5 text-zinc-600 font-bold text-xs">#{i + 1}</td>
                      <td className="px-4 py-2.5 text-zinc-300 text-xs font-mono truncate max-w-[200px]">{u.user_id}</td>
                      <td className="px-4 py-2.5 text-emerald-400 font-bold">{u.extractions}</td>
                      <td className="px-4 py-2.5 text-cyan-400 font-bold">{u.seo_scans}</td>
                      <td className="px-4 py-2.5 text-purple-400 font-bold">{u.campaigns}</td>
                      <td className="px-4 py-2.5 text-yellow-400 font-bold">{u.emails_sent}</td>
                      <td className="px-4 py-2.5">
                        <div className="flex items-center gap-2">
                          <div className="flex-1 bg-zinc-800 rounded-full h-1.5 max-w-[80px]">
                            <div className="bg-emerald-500 h-1.5 rounded-full"
                              style={{ width: `${Math.min(100, (total / Math.max(1, usage[0]?.extractions + usage[0]?.seo_scans + usage[0]?.campaigns)) * 100)}%` }}/>
                          </div>
                          <span className="text-zinc-300 font-bold text-xs">{total}</span>
                        </div>
                      </td>
                    </tr>
                  )
                })}
                {usage.length === 0 && !dataLoading && (
                  <tr><td colSpan={7} className="px-4 py-8 text-center text-zinc-600 text-sm">No usage data yet</td></tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </main>
    </div>
  )
}
