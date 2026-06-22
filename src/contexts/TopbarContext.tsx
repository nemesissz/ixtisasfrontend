import { createContext, useContext, useState, useRef, useCallback, ReactNode } from 'react'

interface TopbarCtx {
  slot:     ReactNode
  setSlot:  (node: ReactNode) => number   // token qaytarır
  clearSlot:(token: number) => void        // yalnız öz token-i ilə silinir
}

export const TopbarContext = createContext<TopbarCtx>({
  slot: null,
  setSlot:  () => 0,
  clearSlot: () => {},
})

export function TopbarProvider({ children }: { children: ReactNode }) {
  const [slot, _setSlot] = useState<ReactNode>(null)
  const tokenRef         = useRef(0)

  const setSlot = useCallback((node: ReactNode) => {
    const t = ++tokenRef.current
    _setSlot(node)
    return t
  }, [])

  const clearSlot = useCallback((token: number) => {
    if (token === tokenRef.current) _setSlot(null)
  }, [])

  return (
    <TopbarContext.Provider value={{ slot, setSlot, clearSlot }}>
      {children}
    </TopbarContext.Provider>
  )
}

export const useTopbar = () => useContext(TopbarContext)
