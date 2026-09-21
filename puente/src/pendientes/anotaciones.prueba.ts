import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { describirCambios } from './anotaciones.js';

describe('describirCambios', () => {
  const anterior = {
    title: 'Portal de proveedores',
    description: 'Lo capturado rápido',
    priority: 'media' as const,
    company: 'Dealer Solutions',
    project: 'Vanguardia'
  };

  it('solo anota lo que cambió aunque llegue el formulario completo', () => {
    const texto = describirCambios(
      {
        title: 'Portal de proveedores',
        description: 'Lo capturado rápido, ya completo',
        priority: 'alta',
        company: 'Dealer Solutions',
        project: 'Vanguardia'
      },
      anterior
    );
    assert.equal(texto, 'Descripción editada · Prioridad: media → alta');
  });

  it('sin cambios reales no dice nada', () => {
    assert.equal(describirCambios({ ...anterior }, anterior), '');
  });

  it('la fecha se compara como instante y se muestra en hora de México', () => {
    const texto = describirCambios(
      { dueDate: '2026-09-21T12:00:00.000Z' },
      { dueDate: '2026-09-21T12:00:00Z' }
    );
    assert.equal(texto, '');
    // Sin hora, solo el día; con hora (dueHasTime), el día y la hora.
    assert.match(
      describirCambios({ dueDate: '2026-09-21T18:00:00.000Z' }, anterior),
      /^Fecha: \(vacío\) → 21 sept? 2026$/
    );
    assert.match(
      describirCambios(
        { dueDate: '2026-09-21T18:00:00.000Z', dueHasTime: true },
        anterior
      ),
      /^Fecha: \(vacío\) → 21 sept? 2026, 12:00/
    );
  });

  it('sin el pendiente anterior lista todo', () => {
    assert.equal(
      describirCambios({ title: 'Nuevo', company: undefined }),
      'Título: Nuevo · Empresa: (vacío)'
    );
  });

  it('las fotos se anotan sin volcar el data URL', () => {
    assert.equal(
      describirCambios({ imagenes: ['data:image/jpeg;base64,xx'] }),
      'Fotos editadas'
    );
    assert.equal(
      describirCambios({ imagenes: [] }, { imagenes: ['x'] }),
      'Fotos quitadas'
    );
    assert.equal(
      describirCambios(
        { imagenes: ['data:image/jpeg;base64,xx'] },
        { imagenes: ['data:image/jpeg;base64,xx'] }
      ),
      ''
    );
  });
});
