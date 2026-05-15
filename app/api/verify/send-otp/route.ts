// ════════════════════════════════════════════════════════════════
// 📨 POST /api/verify/send-otp
// ────────────────────────────────────────────────────────────────
// 사용자가 입력한 학교 이메일로 6자리 OTP 코드를 발송하는 라우트.
//
// 핵심 포인트:
//   - 로그인된 사용자에 한해 발송합니다 (Authorization Bearer 토큰).
//   - 이 라우트는 절대 새 계정을 만들지 않아요. 즉, 기존 supabase auth OTP
//     플로우와 달리 "이미 로그인된 유저의 학교 이메일을 검증"하는 용도예요.
//   - 코드는 otp_verifications 테이블(email, code)에 저장합니다.
//   - 발송은 nodemailer + Gmail App Password 로 진행합니다.
// ════════════════════════════════════════════════════════════════

import { NextResponse } from 'next/server'
import nodemailer from 'nodemailer'
import { getUserFromRequest } from '@/lib/supabase-server'

// 이 라우트는 Node 런타임이 필요합니다 (nodemailer가 Edge에서 동작 X)
export const runtime = 'nodejs'

// 6자리 숫자 코드를 만듭니다. 항상 6자리가 되도록 0 패딩.
function generateSixDigitCode(): string {
  const n = Math.floor(Math.random() * 1_000_000)
  return n.toString().padStart(6, '0')
}

// nodemailer transporter — Gmail SMTP + 앱 비밀번호 사용
function createMailTransport() {
  return nodemailer.createTransport({
    service: 'gmail',
    auth: {
      user: process.env.GMAIL_USER,
      pass: process.env.GMAIL_APP_PASSWORD,
    },
  })
}

export async function POST(request: Request) {
  // 1) 로그인 여부 확인 — 로그인된 사용자만 호출 가능
  const auth = await getUserFromRequest(request)
  if (!auth) {
    return NextResponse.json(
      { error: '세션이 만료됐어요. 다시 로그인해주세요.' },
      { status: 401 },
    )
  }

  // 2) 입력값 파싱
  let body: { email?: string }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: '잘못된 요청이에요.' }, { status: 400 })
  }

  const email = body.email?.trim().toLowerCase() ?? ''
  if (!email) {
    return NextResponse.json({ error: '이메일을 입력해주세요.' }, { status: 400 })
  }

  // 3) 연세대 도메인 제한 — Onloop 정책상 학교 이메일만 허용
  if (!email.endsWith('@yonsei.ac.kr')) {
    return NextResponse.json(
      { error: '연세대학교 이메일(@yonsei.ac.kr)만 사용할 수 있어요.' },
      { status: 400 },
    )
  }

  // 4) 6자리 코드 생성 후 otp_verifications 테이블에 저장
  const code = generateSixDigitCode()

  const { error: insertError } = await auth.client
    .from('otp_verifications')
    .insert({ email, code })

  if (insertError) {
    console.error('[send-otp] otp_verifications insert failed:', insertError)
    return NextResponse.json(
      { error: '인증 코드를 저장하는 중 문제가 발생했어요.' },
      { status: 500 },
    )
  }

  // 5) 이메일 발송
  try {
    const transporter = createMailTransport()
    await transporter.sendMail({
      from: `"Onloop 인증센터" <${process.env.GMAIL_USER}>`,
      to: email,
      subject: '[Onloop] 학생 인증 코드 안내',
      text:
        `안녕하세요, Onloop 입니다.\n\n` +
        `아래 6자리 코드를 인증 화면에 입력해주세요.\n\n` +
        `   ${code}\n\n` +
        `코드는 발급 후 10분간만 유효합니다.\n` +
        `본인이 요청하지 않았다면 이 메일은 무시하셔도 괜찮습니다.\n`,
      html: `
        <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; max-width: 480px; margin: 0 auto; padding: 32px 24px; color: #0f172a;">
          <p style="font-size: 11px; letter-spacing: 0.5px; text-transform: uppercase; color: #0e7c66; font-weight: 600; margin: 0 0 12px;">
            Onloop · Verification
          </p>
          <h1 style="font-size: 22px; line-height: 1.3; margin: 0 0 8px;">학생 인증 코드</h1>
          <p style="font-size: 14px; color: #475569; line-height: 1.6; margin: 0 0 24px;">
            아래 6자리 코드를 인증 화면에 입력해주세요. 코드는 10분간 유효합니다.
          </p>
          <div style="background: #ecfdf5; border: 1px solid #a7f3d0; border-radius: 12px; padding: 20px; text-align: center; font-size: 28px; letter-spacing: 8px; font-weight: 600; color: #064e3b;">
            ${code}
          </div>
          <p style="font-size: 12px; color: #94a3b8; line-height: 1.6; margin: 24px 0 0;">
            본인이 요청하지 않았다면 이 메일은 무시하셔도 괜찮습니다.
          </p>
        </div>
      `,
    })
  } catch (err) {
    console.error('[send-otp] mail send failed:', err)
    return NextResponse.json(
      { error: '메일 발송 중 문제가 발생했어요. 잠시 후 다시 시도해주세요.' },
      { status: 500 },
    )
  }

  return NextResponse.json({ ok: true })
}
