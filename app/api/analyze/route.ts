// app/api/analyze/route.ts
import { NextResponse } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
})

export async function POST(req: Request) {
  const { text } = await req.json()

  const msg = await anthropic.messages.create({
    model: "claude-3-5-sonnet-20241022",
    max_tokens: 1000,
    temperature: 0,
    system: `너는 중고 기부 플랫폼 'Onloop'의 분류 전문가야. 
    사용자가 쉼표로 구분해 보내는 물품 리스트를 분석해서 JSON 형식으로만 답해줘.
    1. recognized: { name, category } 목록. (카테고리: Furniture, Kitchen, Electronics, Bedding, Study, Accessories 중 택1)
    2. rejected: { name, reason } 목록. (의약품, 음식, 주류, 담배, 개봉 화장품, 대형 가구 등 금지 품목 필터링)`,
    messages: [{ role: "user", content: text }],
  })

  // Claude의 응답에서 JSON만 추출하여 전달
  const responseText = msg.content[0].type === 'text' ? msg.content[0].text : ''
  return NextResponse.json(JSON.parse(responseText))
}