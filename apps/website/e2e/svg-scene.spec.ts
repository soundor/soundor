import { expect, test } from '@playwright/test';

interface ProbeNode {
  style: Record<string, unknown>;
  layout: { x: number; y: number; width: number; height: number };
  children: readonly unknown[];
}
declare global {
  interface Window {
    svgProbe: { svg: ProbeNode; parent: ProbeNode; clicks: number };
  }
}

const SCRIPT = `globalThis.soundorPlayground={start({modules}){
 const ui=modules['soundor:ui'];
 const root=ui.root;
 root.style={alignItems:'flex-start',backgroundColor:'white'};
 const parent=ui.createView({width:160,height:140,padding:12,borderWidth:2,borderColor:'black',overflow:'hidden',borderRadius:12});
 const svg=ui.createSvg({width:100,height:100});
 svg.debugId='svg-scene';svg.focusable=true;svg.accessibility={role:'button',label:'Vector control'};
 let active=false;const data=()=>({version:1,viewBox:[0,0,100,100],children:[{type:'circle',cx:50,cy:50,r:40,presentation:{fill:active?'blue':'red'}}]});
 svg.setSvgScene(data());parent.appendChild(svg);root.appendChild(parent);
 globalThis.svgProbe={svg,parent,root,clicks:0,data};
 svg.addEventListener('click',()=>{active=!active;svgProbe.clicks++;svg.setSvgScene(data());});
}};`;

for (const deviceScaleFactor of [1, 2]) {
  test.describe(`SVG scene at DPR ${deviceScaleFactor}`, () => {
    test.use({ deviceScaleFactor });
    test('native browser vectors resize, update and receive root input through transformed parents', async ({
      page,
    }) => {
      const errors: string[] = [];
      page.on('pageerror', (error) => errors.push(error.message));
      await page.route(
        (url) => url.pathname === '/svg-scene-probe.js',
        (route) =>
          route.fulfill({ contentType: 'text/javascript', body: SCRIPT }),
      );
      await page.goto(
        '/examples/primitives/index.html?embed&playground=/svg-scene-probe.js',
      );
      const svg = page.getByRole('button', { name: 'Vector control' });
      await expect(svg).toBeVisible();
      expect(await svg.evaluate((el) => el.namespaceURI)).toBe(
        'http://www.w3.org/2000/svg',
      );
      expect(await svg.locator('circle').count()).toBe(1);
      // A transparent viewport corner still targets the normal Soundor root.
      await svg.click({ position: { x: 2, y: 2 } });
      await expect(svg.locator('circle')).toHaveAttribute('fill', 'blue');
      expect(await page.evaluate(() => window.svgProbe.clicks)).toBe(1);
      await svg.evaluate(() => {
        const probe = window.svgProbe;
        probe.parent.style = {
          ...probe.parent.style,
          transform: [{ translateX: 20 }, { rotate: 0.25 }],
        };
      });
      const logical = await page.evaluate(() => {
        const node = window.svgProbe.svg;
        return { layout: node.layout, children: node.children.length };
      });
      expect(logical.children).toBe(0);
      expect(logical.layout.width).toBeCloseTo(100, 3);
      expect(logical.layout.height).toBeCloseTo(100, 3);
      expect(logical.layout.x).toBeCloseTo(14, 2);
      expect(logical.layout.y).toBeCloseTo(14, 2);
      await page.evaluate(() => {
        window.svgProbe.svg.style = { width: 40 };
      });
      expect(
        (await page.evaluate(() => window.svgProbe.svg.layout)).height,
      ).toBeCloseTo(40, 3);
      await page.evaluate(() => {
        window.svgProbe.svg.style = { width: 100, height: 100 };
      });
      await svg.click();
      await expect(svg.locator('circle')).toHaveAttribute('fill', 'red');
      await svg.evaluate(() => {
        const probe = window.svgProbe;
        probe.svg.style = {
          width: 100,
          height: 100,
          padding: 8,
          borderWidth: 2,
          borderColor: 'black',
          transform: [{ translateX: 3 }, { rotate: -0.2 }],
        };
      });
      const padded = await page.evaluate(() => window.svgProbe.svg.layout);
      expect(padded.width).toBeCloseTo(100, 3);
      expect(padded.height).toBeCloseTo(100, 3);
      expect(padded.x).toBeCloseTo(14, 2);
      expect(padded.y).toBeCloseTo(14, 2);

      await svg.evaluate(() => {
        const probe = window.svgProbe;
        probe.parent.style = {
          width: 180,
          height: 160,
          padding: 12,
          overflow: 'hidden',
          borderRadius: 12,
        };
        probe.svg.style = { width: '100%', height: 100 };
      });
      await expect(svg).toHaveCSS('width', '156px');
      await svg.evaluate((el) => {
        (el as SVGSVGElement).style.width = '8px';
        (el as SVGSVGElement).style.height = '8px';
      });
      await svg.screenshot();
      await svg.evaluate((el) => {
        (el as SVGSVGElement).style.width = '100px';
        (el as SVGSVGElement).style.height = '100px';
      });
      for (const scale of [0.5, 1, 1.5, 2]) {
        await page.locator('.soundor-viewport').evaluate((el, value) => {
          (el as HTMLElement).style.transformOrigin = '0 0';
          (el as HTMLElement).style.transform = 'scale(' + value + ')';
        }, scale);
        const png = (await svg.screenshot({ scale: 'device' })).toString(
          'base64',
        );
        const sample = await page.evaluate(async (encoded) => {
          const bitmap = await createImageBitmap(
            await (await fetch('data:image/png;base64,' + encoded)).blob(),
          );
          const canvas = document.createElement('canvas');
          canvas.width = bitmap.width;
          canvas.height = bitmap.height;
          const context = canvas.getContext('2d')!;
          context.drawImage(bitmap, 0, 0);
          bitmap.close();
          const { data } = context.getImageData(
            0,
            0,
            canvas.width,
            canvas.height,
          );
          let wrong = 0;
          const radius = canvas.width * 0.4;
          for (let y = 3; y < canvas.height - 3; y++)
            for (let x = 3; x < canvas.width - 3; x++) {
              const distance = Math.hypot(
                  x + 0.5 - canvas.width / 2,
                  y + 0.5 - canvas.height / 2,
                ),
                offset = (y * canvas.width + x) * 4;
              if (
                distance < radius - 2.5 &&
                (data[offset]! < 245 ||
                  data[offset + 1]! > 10 ||
                  data[offset + 2]! > 10 ||
                  data[offset + 3]! < 245)
              )
                wrong++;
              if (
                distance > radius + 2.5 &&
                data[offset]! > 200 &&
                data[offset + 1]! < 20
              )
                wrong++;
            }
          return { width: canvas.width, height: canvas.height, wrong };
        }, png);
        expect(sample.width).toBeCloseTo(100 * scale * deviceScaleFactor, 0);
        expect(sample.height).toBeCloseTo(100 * scale * deviceScaleFactor, 0);
        expect(sample.wrong).toBe(0);
      }
      expect(errors).toEqual([]);
    });
  });
}
