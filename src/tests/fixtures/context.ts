/** Builds the context HTML structure in `document.body` and registers Tabspot roots. */
import { setTabspotAttributes, tabspot } from "../../index.ts";
import type { TabspotInstance, TabspotOptions } from "../../index.ts";

export interface ContextRefs {
  instance: TabspotInstance;
  header: HTMLElement;
  main: HTMLElement;
  footer: HTMLElement;
  byId: (id: string) => HTMLElement;
  byText: (text: string) => HTMLElement;
  teardown(): void;
}

export function mountContext(opts: TabspotOptions = {}): ContextRefs {
  document.body.innerHTML = `
    <header>
      <a id="header-first" href="#"><img alt=""></a>
      <nav>
        <ul class="navigation">
          <li tabindex="0">Link #1</li>
          <li>Link #2</li>
          <li>
            <div id="link3" tabindex="0">Link #3</div>
            <ul id="header-groupped-navigation" class="navigation"
                data-tabspot='{"mover":{"axis":"horizontal","cyclic":true},"grouper":{"exitDirection":"up","enterDirection":"right"}}'>
              <li tabindex="0">Link #4</li>
              <li tabindex="0"
                  data-tabspot='{"mover":{"axis":"vertical"}}'>
                Link #5
                <button>Button</button>
                <button>Button2</button>
                <button>Button3</button>
              </li>
              <li tabindex="0">Link #6</li>
            </ul>
          </li>
        </ul>
        <ul class="navigation">
          <li tabindex="0">Link #7</li>
          <li>Link #8</li>
          <li id="header-last" tabindex="0">Link #9</li>
        </ul>
      </nav>
    </header>

    <main>
      <div class="hero">
        <h1>Page Title</h1>
        <ul class="vertical-social-links">
          <li tabindex="0">Link #10</li>
          <li tabindex="0">Link #11</li>
          <li tabindex="0">Link #12</li>
        </ul>
      </div>
    </main>

    <footer>
      <div class="column" data-tabspot='{"grouper":{}}'>
        <a href="#">Link 13</a>
        <a href="#">Link 14</a>
        <a href="#">Link 15</a>
        <div class="row"
             data-tabspot='{"grouper":{"exitDirection":"up","enterDirection":"right"},"mover":{"axis":"horizontal"}}'>
          <a href="#">SubLink 15-1</a>
          <a href="#">SubLink 15-2</a>
          <a href="#">SubLink 15-3</a>
        </div>
      </div>
      <div class="column" data-tabspot='{"grouper":{}}'>
        <a href="#">Link 16</a>
        <a href="#">Link 17</a>
        <a href="#">Link 18</a>
        <div class="row"
             data-tabspot='{"grouper":{"exitDirection":"up","enterDirection":"right"},"mover":{"axis":"vertical"}}'>
          <a href="#">SubLink 16-1</a>
          <a href="#">SubLink 16-2</a>
          <a href="#">SubLink 16-3</a>
        </div>
      </div>
      <div class="row">
        <a href="#">Link 19</a>
        <a href="#">Link 20</a>
        <a href="#">Link 21</a>
        <div class="row"
             data-tabspot='{"grouper":{"exitDirection":"right","enterDirection":"left","enterExitOnLast":true},"mover":{"axis":"horizontal"}}'>
          <a href="#">SubLink 21-1</a>
          <a href="#">SubLink 21-2</a>
          <a href="#">SubLink 21-3</a>
        </div>
      </div>
    </footer>
  `;

  const header = document.querySelector("header") as HTMLElement;
  const main = document.querySelector("main") as HTMLElement;
  const footer = document.querySelector("footer") as HTMLElement;

  const instance = tabspot(opts);

  setTabspotAttributes({
    element: header,
    config: {
      root: {
        manageEscape: true,
        manageHomeEnd: true,
      },
      mover: { axis: "vertical", cyclic: true },
    },
  });
  setTabspotAttributes({
    element: main,
    config: { root: { manageEscape: true, manageHomeEnd: true }, mover: { axis: "horizontal" } },
  });
  setTabspotAttributes({
    element: footer,
    config: {
      root: { manageEscape: true, manageHomeEnd: true },
      mover: { axis: "vertical", cyclic: true },
    },
  });

  return {
    instance,
    header,
    main,
    footer,
    byId: (id) => document.getElementById(id) as HTMLElement,
    byText: (text) => {
      const nodes = document.querySelectorAll<HTMLElement>(
        "a, button, li[tabindex], div[tabindex]",
      );
      for (const n of nodes) {
        if ((n.textContent ?? "").trim() === text) return n;
      }
      throw new Error(`No focusable with text "${text}"`);
    },
    teardown() {
      instance.destroy();
      document.body.innerHTML = "";
    },
  };
}

export function press(el: HTMLElement, key: string, init: KeyboardEventInit = {}): void {
  el.focus();
  const ev = new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, ...init });
  el.dispatchEvent(ev);
}
