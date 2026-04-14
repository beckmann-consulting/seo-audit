import { NextResponse } from 'next/server';

export async function GET() {
  return NextResponse.json({
    hasGoogleKey: !!(process.env.GOOGLE_API_KEY && process.env.GOOGLE_API_KEY !== 'DEIN_KEY_HIER'),
  });
}
