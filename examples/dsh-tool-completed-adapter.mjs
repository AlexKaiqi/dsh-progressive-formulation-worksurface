/** Normalize one actual DSH tool/result without copying its model-facing content. */
export function adaptDshToolCompleted({ authority, sessionId, events, resultSeq }) {
  const result = events.find((event) => event.seq === resultSeq)
  if (result?.type !== 'tool/result') throw new Error(`DSH seq ${resultSeq} is not tool/result`)
  const block = result.data.message?.content?.[0]
  if (block?.type !== 'tool-result') throw new Error('tool/result has no tool-result message block')
  const callId = block.toolCallId
  const call = events.findLast((event) => event.seq < result.seq
    && event.type === 'tool/call'
    && event.data.callId === callId)
  if (call === undefined) throw new Error(`tool/result has no preceding tool/call for ${callId}`)

  const failed = result.data.error !== undefined || block.isError === true
  return {
    ref: {
      source: 'dsh',
      subject: { authority, kind: 'dsh-session', id: sessionId },
      seq: result.seq,
      id: `dsh:${sessionId}:${result.seq}`,
    },
    payload: {
      turn: result.data.turn,
      step: result.data.step,
      callId,
      toolName: call.data.name,
      status: failed ? 'failed' : 'succeeded',
      ...(result.data.error?.code === undefined ? {} : { errorCode: result.data.error.code }),
    },
  }
}
