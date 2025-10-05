import React, { useEffect, useRef, useState } from 'react'
import Peer from 'peerjs'

export default function App() {
  const [mode, setMode] = useState('disconnected')
  const [roomCode, setRoomCode] = useState('')
  const [inputCode, setInputCode] = useState('')
  const [isMuted, setIsMuted] = useState(false)
  const [isSpeakerOn, setIsSpeakerOn] = useState(true)
  const [connectionStatus, setConnectionStatus] = useState('')
  const [peerStatus, setPeerStatus] = useState('')
  const [showAssistant, setShowAssistant] = useState(false)
  const [assistantQuery, setAssistantQuery] = useState('')
  const [assistantResponse, setAssistantResponse] = useState('')
  const [isListening, setIsListening] = useState(false)
  const [location, setLocation] = useState(null)

  const peerRef = useRef(null)
  const callRef = useRef(null)
  const localStreamRef = useRef(null)
  const remoteAudioRef = useRef(null)
  const recognitionRef = useRef(null)
  const synthRef = useRef(null)

  useEffect(() => {
    setPeerStatus('Sistema listo')

    // 🔧 FIX 1: pedir permiso de micrófono al cargar (evita "Iniciando...")
    if (navigator.mediaDevices?.getUserMedia) {
      navigator.mediaDevices.getUserMedia({ audio: true })
        .then(stream => stream.getTracks().forEach(t => t.stop()))
        .catch(() => {})
    }

    // Configuración de voz a texto (opcional)
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition
    if (SpeechRecognition) {
      const rec = new SpeechRecognition()
      rec.continuous = false
      rec.lang = 'es-ES'
      rec.interimResults = false
      rec.onresult = (e) => {
        const transcript = e.results[0][0].transcript
        setAssistantQuery(transcript)
        handleAssistantQuery(transcript)
      }
      rec.onerror = () => { setIsListening(false); setAssistantResponse('Error al escuchar. Intenta de nuevo.') }
      rec.onend = () => setIsListening(false)
      recognitionRef.current = rec
    }

    if ('speechSynthesis' in window) synthRef.current = window.speechSynthesis
    return () => { disconnect() }
  }, [])

  const getLocation = () => {
    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        (pos) => setLocation({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
        () => {}
      )
    }
  }

  const generateRoomCode = () =>
    Math.random().toString(36).substring(2, 8).toUpperCase()

  // 🔧 FIX 2: PeerJS en HTTPS usando servidor público
  const peerOpts = { debug: 1, secure: true, host: '0.peerjs.com', port: 443, path: '/' }

  const startAsHost = async () => {
    try {
      setConnectionStatus('Iniciando...')
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
        video: false
      })
      localStreamRef.current = stream

      const code = generateRoomCode()
      setRoomCode(code)

      peerRef.current = new Peer(code, peerOpts)
      peerRef.current.on('open', () => {
        setMode('host')
        setConnectionStatus('Esperando conexión...')
        getLocation()
      })
      peerRef.current.on('call', (call) => {
        setConnectionStatus('Llamada entrante...')
        call.answer(stream)
        call.on('stream', (remoteStream) => {
          if (remoteAudioRef.current) {
            remoteAudioRef.current.srcObject = remoteStream
            remoteAudioRef.current.muted = false
          }
          setMode('connected')
          setConnectionStatus('Conectado - Línea abierta')
          callRef.current = call
        })
        call.on('close', disconnect)
        call.on('error', () => setConnectionStatus('Error en la llamada'))
      })
      peerRef.current.on('error', (err) => setConnectionStatus('Error de conexión: ' + err.type))
    } catch {
      setConnectionStatus('Error: No se puede acceder al micrófono')
    }
  }

  const connectAsClient = async (code) => {
    if (!code || code.length !== 6) { setConnectionStatus('Código inválido'); return }
    try {
      setMode('client')
      setRoomCode(code)
      setConnectionStatus('Obteniendo micrófono...')
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
        video: false
      })
      localStreamRef.current = stream
      setConnectionStatus('Conectando...')

      peerRef.current = new Peer(peerOpts)
      peerRef.current.on('open', () => {
        setConnectionStatus('Llamando a la sala...')
        const call = peerRef.current.call(code, stream)
        callRef.current = call
        call.on('stream', (remoteStream) => {
          if (remoteAudioRef.current) {
            remoteAudioRef.current.srcObject = remoteStream
            remoteAudioRef.current.muted = false
          }
          setMode('connected')
          setConnectionStatus('Conectado - Línea abierta')
          getLocation()
        })
        call.on('close', disconnect)
        call.on('error', () => setConnectionStatus('Error: No se pudo conectar'))
      })
      peerRef.current.on('error', (err) => {
        if (err.type === 'peer-unavailable') setConnectionStatus('Sala no encontrada')
        else setConnectionStatus('Error de conexión: ' + err.type)
      })
    } catch {
      setConnectionStatus('Error: No se puede acceder al micrófono')
    }
  }

  const toggleMute = () => {
    const track = localStreamRef.current?.getAudioTracks()[0]
    if (track) { track.enabled = !track.enabled; setIsMuted(!track.enabled) }
  }
  const toggleSpeaker = () => {
    const el = remoteAudioRef.current
    setIsSpeakerOn(prev => { if (el) el.muted = prev; return !prev })
  }

  const speak = (text) => {
    if (synthRef.current) {
      synthRef.current.cancel()
      const u = new SpeechSynthesisUtterance(text)
      u.lang = 'es-ES'; u.rate = 1; u.pitch = 1
      synthRef.current.speak(u)
    }
  }
  const startListening = () => {
    if (recognitionRef.current) {
      setIsListening(true)
      setAssistantResponse('Escuchando...')
      recognitionRef.current.start()
    } else {
      setAssistantResponse('Tu navegador no soporta reconocimiento de voz.')
    }
  }
  const handleAssistantQuery = (q) => {
    const t = q.toLowerCase()
    let r = ''
    const openMaps = (what) => {
      if (location) window.open(`https://www.google.com/maps/search/${encodeURIComponent(what)}/@${location.lat},${location.lng},15z`, '_blank')
      else window.open(`https://www.google.com/maps/search/${encodeURIComponent(what)}`, '_blank')
    }
    if (t.includes('restaurante') || t.includes('comer')) { r = 'Buscando restaurantes cercanos…'; openMaps('restaurantes') }
    else if (t.includes('gasolinera') || t.includes('gasolina')) { r = 'Buscando gasolineras cercanas…'; openMaps('gasolineras') }
    else if (t.includes('hotel') || t.includes('dormir')) { r = 'Buscando hoteles cercanos…'; openMaps('hoteles') }
    else if (t.includes('café') || t.includes('cafetería')) { r = 'Buscando cafeterías cercanas…'; openMaps('cafeterías') }
    else if (t.includes('farmacia')) { r = 'Buscando farmacias cercanas…'; openMaps('farmacias') }
    else if (t.includes('hospital') || t.includes('médico')) { r = 'Buscando servicios médicos…'; openMaps('hospitales') }
    else if (t.includes('dónde estoy') || t.includes('ubicación')) {
      r = location ? `Tu ubicación aproximada es lat ${location.lat.toFixed(4)}, lon ${location.lng.toFixed(4)}.` : 'Obteniendo tu ubicación…'
    } else if (t.includes('tiempo') || t.includes('clima')) {
      r = 'Abriendo el tiempo…'; window.open('https://www.google.com/search?q=tiempo', '_blank')
    } else {
      r = `Has dicho: "${q}". Puedo buscar restaurantes, gasolineras, hoteles, farmacias o el tiempo.`
    }
    setAssistantResponse(r); speak(r)
  }

  const copyRoomCode = async () => {
    if (!roomCode) return
    try { await navigator.clipboard.writeText(roomCode); setConnectionStatus('Código copiado') } catch {}
  }
  const shareRoom = async () => {
    if (!navigator.share || !roomCode) return copyRoomCode()
    try { await navigator.share({ title: 'Intercomunicador PRO', text: `Únete con este código: ${roomCode}` }) } catch {}
  }

  const disconnect = () => {
    try {
      localStreamRef.current?.getTracks().forEach(t => t.stop())
      callRef.current?.close()
      peerRef.current?.destroy()
    } catch {}
    if (remoteAudioRef.current) remoteAudioRef.current.srcObject = null
    setMode('disconnected'); setRoomCode(''); setInputCode(''); setConnectionStatus('')
    setIsMuted(false); setIsSpeakerOn(true)
  }

  const Btn = ({onClick, children, className='', disabled}) =>
    <button onClick={onClick} disabled={disabled}
      style={{padding:'12px 16px', borderRadius:12, border:'1px solid #444', background:'#1e293b', color:'#fff', fontWeight:600, opacity:disabled?0.5:1}}
      className={className}>{children}</button>

  return (
    <div style={{minHeight:'100vh', background:'linear-gradient(135deg,#0f172a,#3b0764 60%,#0f172a)', color:'#fff', padding:'24px'}}>
      <div style={{maxWidth:420, margin:'0 auto'}}>
        <div style={{textAlign:'center', marginTop:24, marginBottom:16}}>
          <div style={{fontSize:48, marginBottom:8}}>📡</div>
          <h1 style={{fontWeight:800, fontSize:24, margin:0}}>Intercomunicador PRO</h1>
          <div style={{fontSize:12, color:'#a78bfa'}}>Con Asistente Inteligente</div>
          {peerStatus && <div style={{marginTop:8, fontSize:12, color:'#4ade80'}}>📶 {peerStatus}</div>}
        </div>

        {mode === 'disconnected' && (
          <div style={{display:'grid', gap:12}}>
            <div style={{background:'#0b1220aa', border:'1px solid #334155', borderRadius:16, padding:16}}>
              <h2 style={{textAlign:'center', marginBottom:12}}>Conexión</h2>
              <Btn onClick={startAsHost} className="mb-2">📞 Crear Conexión</Btn>
              <div style={{textAlign:'center', color:'#94a3b8', margin:'8px 0'}}>o</div>
              <input
                placeholder="Código de sala"
                maxLength={6}
                value={inputCode}
                onChange={(e)=>setInputCode(e.target.value.toUpperCase())}
                style={{width:'100%', textAlign:'center', background:'#1f2937', color:'#fff', border:'1px solid #374151', borderRadius:12, padding:12, fontFamily:'monospace', fontSize:18, letterSpacing:2, marginBottom:8}}
              />
              <Btn onClick={()=>connectAsClient(inputCode)} disabled={inputCode.length!==6}>📞 Unirse</Btn>
            </div>
            {connectionStatus && (
              <div style={{background:'#78350f33', border:'1px solid #f59e0b88', borderRadius:12, padding:12, textAlign:'center', color:'#fbbf24'}}>{connectionStatus}</div>
            )}
          </div>
        )}

        {mode === 'host' && (
          <div style={{display:'grid', gap:12}}>
            <div style={{background:'#0b1220aa', border:'1px solid #334155', borderRadius:16, padding:16, textAlign:'center'}}>
              <div style={{fontSize:48, marginBottom:12}}>📞</div>
              <h2 style={{margin:0, marginBottom:8}}>Código de Sala</h2>
              <div style={{background:'#020617', border:'2px solid #8b5cf6', borderRadius:12, padding:16, marginBottom:8}}>
                <div style={{fontFamily:'monospace', fontSize:36, fontWeight:800, letterSpacing:6, color:'#c4b5fd'}}>{roomCode}</div>
              </div>
              <div style={{display:'flex', gap:8, justifyContent:'center'}}>
                <Btn onClick={copyRoomCode}>Copiar</Btn>
                <Btn onClick={shareRoom}>Compartir</Btn>
              </div>
              <div style={{color:'#94a3b8', marginTop:8}}>{connectionStatus}</div>
            </div>
            <Btn onClick={disconnect}>🛑 Cancelar</Btn>
          </div>
        )}

        {mode === 'client' && (
          <div style={{display:'grid', gap:12}}>
            <div style={{background:'#0b1220aa', border:'1px solid #334155', borderRadius:16, padding:16, textAlign:'center'}}>
              <div style={{fontSize:48, marginBottom:12}}>📞</div>
              <h2 style={{margin:0, marginBottom:8}}>{connectionStatus}</h2>
              <div style={{fontFamily:'monospace', fontSize:28, fontWeight:700, color:'#4ade80'}}>{roomCode}</div>
            </div>
            <Btn onClick={disconnect}>🛑 Cancelar</Btn>
          </div>
        )}

        {mode === 'connected' && (
          <div style={{display:'grid', gap:12}}>
            <div style={{background:'#0b1220aa', border:'1px solid #10b981', borderRadius:16, padding:16}}>
              <div style={{textAlign:'center', marginBottom:8}}>
                <div style={{display:'inline-block', padding:12, background:'#10b98133', borderRadius:999, marginBottom:8, fontSize:24}}>📞</div>
                <h2 style={{margin:0}}>Línea Abierta</h2>
                <div style={{color:'#34d399', fontWeight:700, fontSize:12}}>{connectionStatus}</div>
              </div>
              <div style={{display:'grid', gridTemplateColumns:'1fr 1fr', gap:8, marginBottom:8}}>
                <Btn onClick={toggleMute}>{isMuted ? '🤫 Silenciado' : '🎙️ Micro'}</Btn>
                <Btn onClick={toggleSpeaker}>{isSpeakerOn ? '🔊 Altavoz' : '🔇 Sin audio'}</Btn>
              </div>
              <Btn onClick={()=>setShowAssistant(!showAssistant)}>
                {showAssistant ? 'Ocultar Asistente' : '💬 Abrir Asistente'}
              </Btn>
              {showAssistant && (
                <div style={{marginTop:8, background:'#020617', border:'1px solid #7c3aed88', borderRadius:12, padding:12}}>
                  <h3 style={{textAlign:'center', marginTop:0}}>Asistente IA</h3>
                  <Btn onClick={startListening} disabled={isListening}>{isListening ? 'Escuchando…' : '🎙️ Hablar'}</Btn>
                  {assistantQuery && <div style={{marginTop:8, background:'#1e293b', borderRadius:8, padding:8, fontSize:12}}><b>Tú:</b> {assistantQuery}</div>}
                  {assistantResponse && <div style={{marginTop:8, background:'#312e81', borderRadius:8, padding:8, fontSize:12}}><b>Asistente:</b> {assistantResponse}</div>}
                  <div style={{marginTop:8, fontSize:12, color:'#94a3b8'}}>
                    <div>💡 Prueba decir:</div>
                    <div>"Busca restaurantes cerca"</div>
                    <div>"¿Hay gasolineras?"</div>
                    <div>"Dónde estoy"</div>
                  </div>
                </div>
              )}
            </div>
            <Btn onClick={disconnect}>🛑 Desconectar</Btn>
            <div style={{background:'#0b1320', border:'1px solid #334155', borderRadius:12, padding:8, textAlign:'center', fontSize:12, color:'#94a3b8'}}>
              🎧 Auricular Bluetooth | 🗺️ Google Maps
            </div>
          </div>
        )}

        <audio ref={remoteAudioRef} autoPlay playsInline />
      </div>
    </div>
  )
}
