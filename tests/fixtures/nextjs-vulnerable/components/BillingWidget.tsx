'use client'

import { useEffect, useState } from 'react'

type Usage = { seats: number; invoicesThisMonth: number; plan: string }

export function BillingWidget({ teamId }: { teamId: string }) {
  const [usage, setUsage] = useState<Usage | null>(null)

  useEffect(() => {
    fetch(`https://billing.ledgerly.example/v1/teams/${teamId}/usage`, {
      headers: { Authorization: `Bearer ${process.env.BILLING_API_TOKEN}` },
    })
      .then((res) => res.json())
      .then(setUsage)
      .catch(() => setUsage(null))
  }, [teamId])

  if (!usage) return <p>Loading usage…</p>
  return (
    <dl>
      <dt>Plan</dt>
      <dd>{usage.plan}</dd>
      <dt>Seats</dt>
      <dd>{usage.seats}</dd>
      <dt>Invoices this month</dt>
      <dd>{usage.invoicesThisMonth}</dd>
    </dl>
  )
}
