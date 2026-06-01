/* Minimal global types for @amap/amap-jsapi-loader */

declare global {
  interface Window {
    _AMapSecurityConfig?: { securityJsCode: string };
  }

  namespace AMap {
    class Map {
      constructor(container: string | HTMLElement, opts?: Record<string, unknown>);
      add(marker: Marker | Control): void;
      addControl(control: Control): void;
      setZoom(zoom: number): void;
      setCenter(center: [number, number]): void;
      setFitView(
        overlays?: Marker[] | null,
        immediately?: boolean,
        avoid?: number[],
        maxZoom?: number
      ): void;
      destroy(): void;
    }

    class Marker {
      constructor(opts?: { position?: [number, number]; title?: string });
      on(event: string, handler: () => void): void;
      setMap(map: Map | null): void;
    }

    class InfoWindow {
      constructor(opts?: { content?: string | HTMLElement; offset?: Pixel });
      setContent(content: string | HTMLElement): void;
      open(map: Map, position: [number, number]): void;
    }

    class Scale {}
    class ToolBar {
      constructor(opts?: { position?: string });
    }
    class Pixel {
      constructor(x: number, y: number);
    }

    type Control = Scale | ToolBar;
  }
}

export {};
