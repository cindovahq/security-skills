import type { NextApiRequest, NextApiResponse } from 'next'
import { db } from '@/lib/db'

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') return res.status(405).end()

  const teamId = String(req.query.teamId ?? '')
  if (!teamId) return res.status(400).json({ error: 'teamId is required' })

  const members = await db.profile.findMany({
    where: { teamId },
    select: { id: true, username: true, displayName: true, email: true, role: true, createdAt: true },
  })

  res.status(200).json({ members })
}
