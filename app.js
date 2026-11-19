(function () {
  'use strict';

  const CONFIG = window.APP_CONFIG || {};
  const MAX_POR_EQUIPO = Number(CONFIG.MAX_POR_EQUIPO) || 5;

  const state = {
    supabase: null,
    tablero: {
      equipos: [],
      solitarios: [],
      resumen: {
        total_participantes: 0,
        total_equipos: 0,
        equipos_completos: 0,
        equipos_incompletos: 0,
        total_solitarios: 0,
        max_por_equipo: MAX_POR_EQUIPO,
      },
    },
    activeTab: 'registro',
    boardFilter: 'todos',
    boardSearch: '',
    adminUnlocked: false,
    adminSubtab: 'solicitudes',
    adminSolFilter: 'pendientes',
    adminPartSearch: '',
    adminData: {
      equipos: [],
      participantes: [],
      solicitudes: [],
    },
    modalContext: {
      equipoDestinoId: null,
      resetParticipanteId: null,
    },
    xlsxPromise: null,
  };

  // =========================================================================
  // Utilidades
  // =========================================================================

  function $(id) {
    return document.getElementById(id);
  }

  function escapeHtml(value) {
    if (value === null || value === undefined) return '';
    return String(value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function sanitizeDigits(value) {
    return String(value || '').replace(/\D/g, '');
  }

  function buildWhatsappUrl(phone) {
    const digits = sanitizeDigits(phone);
    if (!digits) return '#';
    const intl = digits.length === 10 ? `52${digits}` : digits;
    return `https://wa.me/${intl}`;
  }

  function formatFecha(iso) {
    if (!iso) return '';
    try {
      return new Intl.DateTimeFormat('es-MX', {
        dateStyle: 'short',
        timeStyle: 'short',
      }).format(new Date(iso));
    } catch (_) {
      return String(iso);
    }
  }

  function setAlert(el, message, type) {
    if (!el) return;
    if (!message) {
      el.hidden = true;
      el.textContent = '';
      el.className = 'alert-box';
      return;
    }
    el.hidden = false;
    el.className = `alert-box ${type === 'success' ? 'alert-success' : 'alert-error'}`;
    el.textContent = message;
  }

  function showToast(message, type = 'info') {
    const container = $('toast-container');
    if (!container || !message) return;

    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    toast.textContent = message;
    container.appendChild(toast);

    window.setTimeout(() => {
      toast.remove();
    }, 4500);
  }

  async function setButtonBusy(btn, busy, busyLabel) {
    if (!btn) return;
    if (busy) {
      btn.dataset.origText = btn.textContent;
      btn.disabled = true;
      if (busyLabel) btn.textContent = busyLabel;
    } else {
      btn.disabled = false;
      if (btn.dataset.origText) {
        btn.textContent = btn.dataset.origText;
        delete btn.dataset.origText;
      }
    }
  }

  function getCompatibleOriginTeams(targetTeam) {
    if (!targetTeam || targetTeam.esta_completo) return [];
    return state.tablero.equipos.filter(
      (eq) =>
        eq.id !== targetTeam.id &&
        eq.total_integrantes > 0 &&
        eq.total_integrantes <= targetTeam.total_integrantes &&
        eq.total_integrantes + targetTeam.total_integrantes <= MAX_POR_EQUIPO
    );
  }

  // =========================================================================
  // Navegación por pestañas y modales
  // =========================================================================

  function switchTab(tabName) {
    if (tabName === 'admin') {
      $('tab-btn-admin').hidden = false;
    }

    state.activeTab = tabName;

    document.querySelectorAll('.nav-tab').forEach((btn) => {
      const isMatch = btn.dataset.tab === tabName;
      btn.classList.toggle('active', isMatch);
      btn.setAttribute('aria-selected', isMatch ? 'true' : 'false');
    });

    document.querySelectorAll('.tab-panel').forEach((panel) => {
      const isMatch = panel.id === `panel-${tabName}`;
      panel.hidden = !isMatch;
      panel.classList.toggle('active', isMatch);
    });

    if (tabName === 'admin' && state.adminUnlocked) {
      cargarDatosAdmin();
    }
  }

  function openModal(modalId) {
    const el = $(modalId);
    if (!el) return;
    el.hidden = false;
    const firstInput = el.querySelector('select, input, textarea');
    if (firstInput) firstInput.focus();
  }

  function closeModal(modalId) {
    const el = $(modalId);
    if (!el) return;
    el.hidden = true;
  }

  function closeAllModals() {
    document.querySelectorAll('.modal-backdrop').forEach((m) => {
      m.hidden = true;
    });
  }

  // =========================================================================
  // Carga y renderizado del tablero público
  // =========================================================================

  async function cargarTableroPublico(showSpinnerToast = false) {
    if (!state.supabase) return;
    try {
      const { data, error } = await state.supabase.rpc('obtener_tablero_publico');
      if (error) throw error;

      state.tablero = {
        equipos: Array.isArray(data?.equipos) ? data.equipos : [],
        solitarios: Array.isArray(data?.solitarios) ? data.solitarios : [],
        resumen: data?.resumen || {
          total_participantes: 0,
          total_equipos: 0,
          equipos_completos: 0,
          equipos_incompletos: 0,
          total_solitarios: 0,
          max_por_equipo: MAX_POR_EQUIPO,
        },
      };

      renderResumenStats();
      populateRegistroEquipoSelect();
      renderTableroPublico();

      if (showSpinnerToast) {
        showToast('Tablero actualizado.', 'info');
      }
    } catch (err) {
      console.error('Error cargando tablero:', err);
      showToast('No se pudo cargar el tablero desde Supabase.', 'error');
    }
  }

  function renderResumenStats() {
    const r = state.tablero.resumen || {};
    $('stat-participantes').textContent = r.total_participantes ?? 0;
    $('stat-completos').textContent = r.equipos_completos ?? 0;
    $('stat-incompletos').textContent = r.equipos_incompletos ?? 0;
    $('stat-solitarios').textContent = r.total_solitarios ?? 0;
  }

  function populateRegistroEquipoSelect() {
    const select = $('reg-equipo-select');
    const hint = $('reg-equipo-vacio-hint');
    if (!select) return;

    const currentVal = select.value;
    const disponibles = state.tablero.equipos.filter((eq) => !eq.esta_completo);

    select.innerHTML = '<option value="">-- Selecciona un equipo disponible --</option>';
    disponibles.forEach((eq) => {
      const opt = document.createElement('option');
      opt.value = eq.id;
      opt.textContent = `${eq.nombre} (${eq.total_integrantes}/${MAX_POR_EQUIPO} — ${eq.cupos_disponibles} cupo${eq.cupos_disponibles === 1 ? '' : 's'})`;
      select.appendChild(opt);
    });

    if (currentVal && disponibles.some((eq) => eq.id === currentVal)) {
      select.value = currentVal;
    }

    const modoActual = document.querySelector('input[name="reg-modo"]:checked')?.value;
    if (hint) {
      hint.hidden = !(modoActual === 'unirse_equipo' && disponibles.length === 0);
    }
  }

  function buildSquadCardHtml(eq) {
    const isComplete = Boolean(eq.esta_completo);
    const pipsHtml = Array.from({ length: MAX_POR_EQUIPO }, (_, i) => {
      const filled = i < eq.total_integrantes;
      const cls = filled
        ? isComplete
          ? 'slot-pip slot-pip-complete'
          : 'slot-pip slot-pip-filled'
        : 'slot-pip';
      return `<span class="${cls}"></span>`;
    }).join('');

    const membersHtml = (eq.integrantes || [])
      .map(
        (m) => `
        <li class="member-item">
          <span class="member-name">${escapeHtml(m.nombre_completo)}</span>
          <span class="grade-pill">${escapeHtml(m.grado_grupo)}</span>
        </li>`
      )
      .join('');

    let actionsHtml = '';
    if (!isComplete) {
      const compatibles = getCompatibleOriginTeams(eq);
      const mergeBtn =
        compatibles.length > 0
          ? `<button type="button" class="btn btn-outline btn-sm" data-action="solicitar-fusion" data-equipo-id="${escapeHtml(eq.id)}">
               Unir mi equipo aquí
             </button>`
          : '';

      actionsHtml = `
        <div class="squad-actions">
          <button type="button" class="btn btn-primary btn-sm" data-action="solicitar-unirse" data-equipo-id="${escapeHtml(eq.id)}">
            Solicitar unirme
          </button>
          ${mergeBtn}
        </div>`;
    }

    return `
      <article class="squad-card ${isComplete ? 'squad-card-complete' : 'squad-card-incomplete'}">
        <div class="squad-card-head">
          <h3 class="squad-name">${escapeHtml(eq.nombre)}</h3>
          <span class="badge ${isComplete ? 'badge-green' : 'badge-amber'}">
            ${isComplete ? `COMPLETO ${eq.total_integrantes}/${MAX_POR_EQUIPO}` : `${eq.total_integrantes}/${MAX_POR_EQUIPO} JUGADORES`}
          </span>
        </div>
        <div class="slot-meter" aria-label="Cupo ${eq.total_integrantes} de ${MAX_POR_EQUIPO}">${pipsHtml}</div>
        <ul class="member-list">${membersHtml || '<li class="member-item">Sin integrantes</li>'}</ul>
        ${actionsHtml}
      </article>`;
  }

  function renderTableroPublico() {
    const container = $('tablero-contenido');
    if (!container) return;

    const query = state.boardSearch.trim().toLowerCase();
    const filter = state.boardFilter;

    const matchesTeam = (eq) => {
      if (!query) return true;
      if (eq.nombre.toLowerCase().includes(query)) return true;
      return (eq.integrantes || []).some(
        (m) =>
          m.nombre_completo.toLowerCase().includes(query) ||
          m.grado_grupo.toLowerCase().includes(query)
      );
    };

    const matchesSolo = (p) => {
      if (!query) return true;
      return (
        p.nombre_completo.toLowerCase().includes(query) ||
        p.grado_grupo.toLowerCase().includes(query)
      );
    };

    const incompletos = state.tablero.equipos.filter((eq) => !eq.esta_completo && matchesTeam(eq));
    const completos = state.tablero.equipos.filter((eq) => eq.esta_completo && matchesTeam(eq));
    const solitarios = state.tablero.solitarios.filter(matchesSolo);

    const blocks = [];

    if (filter === 'todos' || filter === 'incompletos') {
      const cards =
        incompletos.length > 0
          ? `<div class="cards-grid">${incompletos.map(buildSquadCardHtml).join('')}</div>`
          : `<div class="empty-state">${query ? 'No hay equipos incompletos que coincidan con tu búsqueda.' : 'No hay equipos incompletos en este momento.'}</div>`;

      blocks.push(`
        <section class="board-section">
          <div class="board-section-head">
            <h3 class="board-section-title">Equipos Incompletos</h3>
            <span class="badge badge-amber">${incompletos.length}</span>
          </div>
          ${cards}
        </section>`);
    }

    if (filter === 'todos' || filter === 'completos') {
      const cards =
        completos.length > 0
          ? `<div class="cards-grid">${completos.map(buildSquadCardHtml).join('')}</div>`
          : `<div class="empty-state">${query ? 'No hay equipos completos que coincidan con tu búsqueda.' : 'Aún no hay equipos completos (5/5).'}</div>`;

      blocks.push(`
        <section class="board-section">
          <div class="board-section-head">
            <h3 class="board-section-title">Equipos Completos (5/${MAX_POR_EQUIPO})</h3>
            <span class="badge badge-green">${completos.length}</span>
          </div>
          ${cards}
        </section>`);
    }

    if (filter === 'todos' || filter === 'solitarios') {
      const solosHtml =
        solitarios.length > 0
          ? `<div class="solo-grid">
               ${solitarios
                 .map(
                   (p) => `
                   <div class="solo-card">
                     <span class="member-name">${escapeHtml(p.nombre_completo)}</span>
                     <span class="grade-pill">${escapeHtml(p.grado_grupo)}</span>
                   </div>`
                 )
                 .join('')}
             </div>`
          : `<div class="empty-state">${query ? 'No hay participantes solitarios que coincidan con tu búsqueda.' : 'No hay participantes solitarios disponibles.'}</div>`;

      blocks.push(`
        <section class="board-section">
          <div class="board-section-head">
            <h3 class="board-section-title">Participantes Solitarios</h3>
            <span class="badge badge-cyan">${solitarios.length}</span>
          </div>
          ${solosHtml}
        </section>`);
    }

    container.innerHTML = blocks.join('');
  }

  // =========================================================================
  // Registro de participante
  // =========================================================================

  function updateModoRegistroUI() {
    const modo = document.querySelector('input[name="reg-modo"]:checked')?.value || 'crear_equipo';
    $('group-crear-equipo').hidden = modo !== 'crear_equipo';
    $('group-unirse-equipo').hidden = modo !== 'unirse_equipo';
    $('group-solitario-hint').hidden = modo !== 'solitario';
    populateRegistroEquipoSelect();
  }

  async function handleRegistroSubmit(event) {
    event.preventDefault();
    const feedback = $('reg-feedback');
    setAlert(feedback, null);

    const nombre = $('reg-nombre').value.trim();
    const grado = $('reg-grado').value.trim().toUpperCase();
    const telefono = sanitizeDigits($('reg-telefono').value);
    const pin = sanitizeDigits($('reg-pin').value);
    const modo = document.querySelector('input[name="reg-modo"]:checked')?.value || 'crear_equipo';
    const nombreEquipo = $('reg-equipo-nombre').value.trim();
    const equipoId = $('reg-equipo-select').value;

    if (nombre.length < 3 || nombre.length > 100) {
      setAlert(feedback, 'Ingresa tu nombre completo (entre 3 y 100 caracteres).', 'error');
      return;
    }
    if (grado.length < 2 || grado.length > 15) {
      setAlert(feedback, 'Ingresa un grado y grupo válido (ejemplo: 9N).', 'error');
      return;
    }
    if (!/^\d{10,15}$/.test(telefono)) {
      setAlert(feedback, 'Ingresa un número de WhatsApp válido de 10 a 15 dígitos.', 'error');
      return;
    }
    if (!/^\d{4}$/.test(pin)) {
      setAlert(feedback, 'Tu PIN personal debe tener exactamente 4 dígitos numéricos.', 'error');
      return;
    }
    if (modo === 'crear_equipo' && (nombreEquipo.length < 2 || nombreEquipo.length > 40)) {
      setAlert(feedback, 'El nombre del equipo debe tener entre 2 y 40 caracteres.', 'error');
      return;
    }
    if (modo === 'unirse_equipo' && !equipoId) {
      setAlert(feedback, 'Selecciona un equipo disponible de la lista.', 'error');
      return;
    }

    const submitBtn = $('btn-reg-submit');
    await setButtonBusy(submitBtn, true, 'REGISTRANDO...');

    try {
      const { data, error } = await state.supabase.rpc('registrar_participante', {
        p_nombre_completo: nombre,
        p_grado_grupo: grado,
        p_telefono: telefono,
        p_pin: pin,
        p_modo: modo,
        p_nombre_equipo: modo === 'crear_equipo' ? nombreEquipo : null,
        p_equipo_id: modo === 'unirse_equipo' ? equipoId : null,
      });

      if (error) throw error;
      if (!data?.ok) {
        setAlert(feedback, data?.error || 'No se pudo completar el registro.', 'error');
        return;
      }

      $('form-registro').reset();
      $('reg-pin').type = 'password';
      $('btn-toggle-reg-pin').textContent = 'Mostrar';
      updateModoRegistroUI();

      setAlert(feedback, data.mensaje || '¡Registro completado con éxito!', 'success');
      showToast('Registro guardado correctamente.', 'success');
      await cargarTableroPublico(false);
    } catch (err) {
      console.error('Error en registro:', err);
      setAlert(feedback, err.message || 'Ocurrió un error al guardar tu registro.', 'error');
    } finally {
      await setButtonBusy(submitBtn, false);
    }
  }

  // =========================================================================
  // Modales de Solicitud Individual, Fusión y Salida de Equipo
  // =========================================================================

  function openModalSolicitudIndividual(equipoId) {
    const eq = state.tablero.equipos.find((e) => e.id === equipoId);
    if (!eq) return;

    state.modalContext.equipoDestinoId = equipoId;
    $('modal-ind-equipo-info').textContent = `Equipo destino: ${eq.nombre} (${eq.total_integrantes}/${MAX_POR_EQUIPO} integrantes — ${eq.cupos_disponibles} cupo${eq.cupos_disponibles === 1 ? '' : 's'})`;
    setAlert($('sol-ind-error'), null);
    $('sol-ind-pin').value = '';
    $('sol-ind-mensaje').value = '';
    $('sol-ind-msg-count').textContent = '0';

    const select = $('sol-ind-participante');
    const solitarios = state.tablero.solitarios;
    select.innerHTML = '<option value="">-- Selecciona tu nombre --</option>';
    solitarios.forEach((p) => {
      const opt = document.createElement('option');
      opt.value = p.id;
      opt.textContent = `${p.nombre_completo} (${p.grado_grupo})`;
      select.appendChild(opt);
    });

    const sinSolos = solitarios.length === 0;
    $('sol-ind-no-solitarios').hidden = !sinSolos;
    $('sol-ind-fields').hidden = sinSolos;

    openModal('modal-solicitud-individual');
  }

  async function handleSolicitudIndividualSubmit(event) {
    event.preventDefault();
    const errEl = $('sol-ind-error');
    setAlert(errEl, null);

    const participanteId = $('sol-ind-participante').value;
    const pin = sanitizeDigits($('sol-ind-pin').value);
    const mensaje = $('sol-ind-mensaje').value.trim();

    if (!participanteId) {
      setAlert(errEl, 'Selecciona tu nombre de la lista de solitarios.', 'error');
      return;
    }
    if (!/^\d{4}$/.test(pin)) {
      setAlert(errEl, 'Ingresa tu PIN de 4 dígitos.', 'error');
      return;
    }

    const submitBtn = $('btn-sol-ind-submit');
    await setButtonBusy(submitBtn, true, 'Enviando...');

    try {
      const { data, error } = await state.supabase.rpc('solicitar_unirse_equipo', {
        p_participante_id: participanteId,
        p_pin: pin,
        p_equipo_destino_id: state.modalContext.equipoDestinoId,
        p_mensaje: mensaje || null,
      });

      if (error) throw error;
      if (!data?.ok) {
        setAlert(errEl, data?.error || 'No se pudo enviar la solicitud.', 'error');
        return;
      }

      closeModal('modal-solicitud-individual');
      showToast(data.mensaje || 'Solicitud enviada al administrador.', 'success');
    } catch (err) {
      console.error('Error en solicitud individual:', err);
      setAlert(errEl, err.message || 'Error al enviar la solicitud.', 'error');
    } finally {
      await setButtonBusy(submitBtn, false);
    }
  }

  function populateDependentMembers(teamSelectEl, memberSelectEl) {
    const teamId = teamSelectEl.value;
    const eq = state.tablero.equipos.find((e) => e.id === teamId);
    memberSelectEl.innerHTML = '';

    if (!eq || !eq.integrantes?.length) {
      memberSelectEl.disabled = true;
      memberSelectEl.innerHTML = '<option value="">-- Primero selecciona tu equipo --</option>';
      return;
    }

    memberSelectEl.disabled = false;
    memberSelectEl.innerHTML = '<option value="">-- Selecciona tu nombre --</option>';
    eq.integrantes.forEach((m) => {
      const opt = document.createElement('option');
      opt.value = m.id;
      opt.textContent = `${m.nombre_completo} (${m.grado_grupo})`;
      memberSelectEl.appendChild(opt);
    });
  }

  function openModalSolicitudFusion(equipoDestinoId) {
    const eqDestino = state.tablero.equipos.find((e) => e.id === equipoDestinoId);
    if (!eqDestino) return;

    const compatibles = getCompatibleOriginTeams(eqDestino);
    if (compatibles.length === 0) {
      showToast('No hay equipos compatibles para fusionarse con esta escuadra.', 'info');
      return;
    }

    state.modalContext.equipoDestinoId = equipoDestinoId;
    $('modal-fus-equipo-info').textContent = `Equipo destino: ${eqDestino.nombre} (${eqDestino.total_integrantes}/${MAX_POR_EQUIPO} integrantes)`;
    setAlert($('sol-fus-error'), null);
    $('sol-fus-pin').value = '';
    $('sol-fus-mensaje').value = '';
    $('sol-fus-msg-count').textContent = '0';

    const originSelect = $('sol-fus-equipo-origen');
    originSelect.innerHTML = '<option value="">-- Selecciona tu equipo --</option>';
    compatibles.forEach((eq) => {
      const opt = document.createElement('option');
      opt.value = eq.id;
      opt.textContent = `${eq.nombre} (${eq.total_integrantes} integrante${eq.total_integrantes === 1 ? '' : 's'})`;
      originSelect.appendChild(opt);
    });

    populateDependentMembers(originSelect, $('sol-fus-participante'));
    openModal('modal-solicitud-fusion');
  }

  async function handleSolicitudFusionSubmit(event) {
    event.preventDefault();
    const errEl = $('sol-fus-error');
    setAlert(errEl, null);

    const originTeamId = $('sol-fus-equipo-origen').value;
    const participanteId = $('sol-fus-participante').value;
    const pin = sanitizeDigits($('sol-fus-pin').value);
    const mensaje = $('sol-fus-mensaje').value.trim();

    if (!originTeamId || !participanteId) {
      setAlert(errEl, 'Selecciona tu equipo actual y tu nombre.', 'error');
      return;
    }
    if (!/^\d{4}$/.test(pin)) {
      setAlert(errEl, 'Ingresa tu PIN de 4 dígitos.', 'error');
      return;
    }

    const submitBtn = $('btn-sol-fus-submit');
    await setButtonBusy(submitBtn, true, 'Enviando...');

    try {
      const { data, error } = await state.supabase.rpc('solicitar_fusion_equipos', {
        p_participante_id: participanteId,
        p_pin: pin,
        p_equipo_destino_id: state.modalContext.equipoDestinoId,
        p_mensaje: mensaje || null,
      });

      if (error) throw error;
      if (!data?.ok) {
        setAlert(errEl, data?.error || 'No se pudo enviar la solicitud de fusión.', 'error');
        return;
      }

      closeModal('modal-solicitud-fusion');
      showToast(data.mensaje || 'Solicitud de fusión enviada al administrador.', 'success');
    } catch (err) {
      console.error('Error en solicitud de fusión:', err);
      setAlert(errEl, err.message || 'Error al enviar la solicitud de fusión.', 'error');
    } finally {
      await setButtonBusy(submitBtn, false);
    }
  }

  function openModalSalirEquipo() {
    setAlert($('salir-error'), null);
    $('salir-pin').value = '';

    const equiposConGente = state.tablero.equipos.filter((eq) => (eq.integrantes || []).length > 0);
    const sinEquipos = equiposConGente.length === 0;
    $('salir-no-equipos').hidden = !sinEquipos;
    $('salir-fields').hidden = sinEquipos;

    const eqSelect = $('salir-equipo-select');
    eqSelect.innerHTML = '<option value="">-- Selecciona tu equipo --</option>';
    equiposConGente.forEach((eq) => {
      const opt = document.createElement('option');
      opt.value = eq.id;
      opt.textContent = `${eq.nombre} (${eq.total_integrantes}/${MAX_POR_EQUIPO})`;
      eqSelect.appendChild(opt);
    });

    populateDependentMembers(eqSelect, $('salir-participante-select'));
    openModal('modal-salir-equipo');
  }

  async function handleSalirEquipoSubmit(event) {
    event.preventDefault();
    const errEl = $('salir-error');
    setAlert(errEl, null);

    const eqId = $('salir-equipo-select').value;
    const participanteId = $('salir-participante-select').value;
    const pin = sanitizeDigits($('salir-pin').value);

    if (!eqId || !participanteId) {
      setAlert(errEl, 'Selecciona tu equipo y tu nombre.', 'error');
      return;
    }
    if (!/^\d{4}$/.test(pin)) {
      setAlert(errEl, 'Ingresa tu PIN de 4 dígitos.', 'error');
      return;
    }

    const submitBtn = $('btn-salir-submit');
    await setButtonBusy(submitBtn, true, 'Procesando...');

    try {
      const { data, error } = await state.supabase.rpc('salir_de_equipo', {
        p_participante_id: participanteId,
        p_pin: pin,
      });

      if (error) throw error;
      if (!data?.ok) {
        setAlert(errEl, data?.error || 'No se pudo procesar tu salida.', 'error');
        return;
      }

      closeModal('modal-salir-equipo');
      showToast(data.mensaje || 'Has salido de tu equipo.', 'success');
      await cargarTableroPublico(false);
    } catch (err) {
      console.error('Error al salir de equipo:', err);
      setAlert(errEl, err.message || 'Ocurrió un error al salir del equipo.', 'error');
    } finally {
      await setButtonBusy(submitBtn, false);
    }
  }

  // =========================================================================
  // Panel de Administración + Exportación a Excel
  // =========================================================================

  function setAdminUIState(unlocked) {
    state.adminUnlocked = unlocked;
    $('admin-login-box').hidden = unlocked;
    $('admin-dashboard').hidden = !unlocked;
    if (unlocked) {
      $('tab-btn-admin').hidden = false;
    }
  }

  async function checkExistingAdminSession() {
    if (!state.supabase) return;
    try {
      const { data } = await state.supabase.auth.getSession();
      if (!data?.session) {
        setAdminUIState(false);
        return;
      }

      const { data: esAdmin, error } = await state.supabase.rpc('admin_verificar');
      if (error || !esAdmin) {
        setAdminUIState(false);
        return;
      }

      setAdminUIState(true);
      if (state.activeTab === 'admin' || window.location.hash === '#admin') {
        await cargarDatosAdmin();
      }
    } catch (err) {
      console.error('Error verificando sesión admin:', err);
      setAdminUIState(false);
    }
  }

  async function handleAdminLoginSubmit(event) {
    event.preventDefault();
    const errEl = $('admin-login-error');
    setAlert(errEl, null);

    const email = $('admin-email').value.trim();
    const password = $('admin-password').value;

    if (!email || !password) {
      setAlert(errEl, 'Ingresa tu correo y contraseña.', 'error');
      return;
    }

    const submitBtn = $('btn-admin-login');
    await setButtonBusy(submitBtn, true, 'Verificando...');

    try {
      const { error: signInErr } = await state.supabase.auth.signInWithPassword({
        email,
        password,
      });
      if (signInErr) throw signInErr;

      const { data: esAdmin, error: checkErr } = await state.supabase.rpc('admin_verificar');
      if (checkErr) throw checkErr;

      if (!esAdmin) {
        await state.supabase.auth.signOut();
        setAlert(errEl, 'Tu cuenta no tiene permisos de administrador.', 'error');
        return;
      }

      $('form-admin-login').reset();
      setAdminUIState(true);
      showToast('Sesión de administrador iniciada.', 'success');
      await cargarDatosAdmin();
    } catch (err) {
      console.error('Error login admin:', err);
      setAlert(errEl, 'Credenciales inválidas o usuario no autorizado.', 'error');
    } finally {
      await setButtonBusy(submitBtn, false);
    }
  }

  async function handleAdminLogout() {
    if (!state.supabase) return;
    await state.supabase.auth.signOut();
    setAdminUIState(false);
    state.adminData = { equipos: [], participantes: [], solicitudes: [] };
    showToast('Sesión cerrada.', 'info');
  }

  async function cargarDatosAdmin(showSuccessToast = false) {
    if (!state.supabase || !state.adminUnlocked) return;
    try {
      const { data, error } = await state.supabase.rpc('admin_obtener_datos');
      if (error) throw error;

      state.adminData = {
        equipos: Array.isArray(data?.equipos) ? data.equipos : [],
        participantes: Array.isArray(data?.participantes) ? data.participantes : [],
        solicitudes: Array.isArray(data?.solicitudes) ? data.solicitudes : [],
      };

      renderAdminDashboard();
      if (showSuccessToast) {
        showToast('Datos administrativos actualizados.', 'info');
      }
    } catch (err) {
      console.error('Error cargando datos admin:', err);
      showToast('Error al cargar datos de administración.', 'error');
    }
  }

  function switchAdminSubtab(subtab) {
    state.adminSubtab = subtab;
    document.querySelectorAll('.admin-subtab').forEach((btn) => {
      const match = btn.dataset.adminTab === subtab;
      btn.classList.toggle('active', match);
      btn.setAttribute('aria-selected', match ? 'true' : 'false');
    });
    document.querySelectorAll('.admin-panel').forEach((p) => {
      const match = p.id === `admin-tab-${subtab}`;
      p.hidden = !match;
      p.classList.toggle('active', match);
    });
  }

  function renderAdminDashboard() {
    const pendientesCount = state.adminData.solicitudes.filter((s) => s.estado === 'pendiente').length;
    $('admin-badge-pendientes').textContent = `${pendientesCount} pendiente${pendientesCount === 1 ? '' : 's'}`;

    renderAdminSolicitudes();
    renderAdminParticipantes();
    renderAdminEquipos();
  }

  function renderRequestTeamList(title, members) {
    const rows = (members || [])
      .map(
        (m) => `
        <li>
          ${escapeHtml(m.nombre_completo)} (${escapeHtml(m.grado_grupo)}) &mdash;
          <a class="wa-link" href="${escapeHtml(buildWhatsappUrl(m.telefono))}" target="_blank" rel="noopener noreferrer">${escapeHtml(m.telefono)}</a>
        </li>`
      )
      .join('');

    return `
      <div class="request-team-box">
        <strong>${escapeHtml(title)} (${(members || []).length}/${MAX_POR_EQUIPO})</strong>
        <ul>${rows || '<li>Sin integrantes</li>'}</ul>
      </div>`;
  }

  function renderAdminSolicitudes() {
    const container = $('admin-solicitudes-list');
    if (!container) return;

    const list =
      state.adminSolFilter === 'pendientes'
        ? state.adminData.solicitudes.filter((s) => s.estado === 'pendiente')
        : state.adminData.solicitudes;

    if (list.length === 0) {
      container.innerHTML = `<div class="empty-state">${
        state.adminSolFilter === 'pendientes'
          ? 'No hay solicitudes pendientes por revisar.'
          : 'Aún no se ha registrado ninguna solicitud.'
      }</div>`;
      return;
    }

    const estadoBadgeClass = {
      pendiente: 'badge-amber',
      aceptada: 'badge-green',
      rechazada: 'badge-red',
      cancelada: 'badge-muted',
    };

    container.innerHTML = list
      .map((s) => {
        const sol = s.solicitante || {};
        const esFusion = s.tipo === 'fusion';
        const titulo = esFusion
          ? `Fusión: "${s.equipo_origen_nombre || 'Equipo origen'}" → "${s.equipo_destino_nombre}"`
          : `Ingreso a "${s.equipo_destino_nombre}"`;

        const msgBlock = s.mensaje
          ? `<div class="request-msg"><strong>Mensaje:</strong> ${escapeHtml(s.mensaje)}</div>`
          : '';

        const teamsGrid = esFusion
          ? `<div class="request-teams-grid">
               ${renderRequestTeamList(`Origen: ${s.equipo_origen_nombre || 'Eliminado'}`, s.equipo_origen_integrantes)}
               ${renderRequestTeamList(`Destino: ${s.equipo_destino_nombre}`, s.equipo_destino_integrantes)}
             </div>`
          : `<div class="request-teams-grid">
               ${renderRequestTeamList(`Integrantes actuales en ${s.equipo_destino_nombre}`, s.equipo_destino_integrantes)}
             </div>`;

        const actionsBlock =
          s.estado === 'pendiente'
            ? `<div class="request-actions">
                 <button type="button" class="btn btn-success btn-sm" data-admin-action="aceptar-sol" data-sol-id="${escapeHtml(s.id)}">
                   Aceptar
                 </button>
                 <button type="button" class="btn btn-danger-outline btn-sm" data-admin-action="rechazar-sol" data-sol-id="${escapeHtml(s.id)}">
                   Rechazar
                 </button>
               </div>`
            : '';

        return `
          <article class="admin-request-card">
            <div class="request-head">
              <div class="request-title-group">
                <span class="badge ${esFusion ? 'badge-cyan' : 'badge-amber'}">${esFusion ? 'FUSIÓN DE EQUIPOS' : 'INDIVIDUAL'}</span>
                <strong>${escapeHtml(titulo)}</strong>
              </div>
              <span class="badge ${estadoBadgeClass[s.estado] || 'badge-muted'}">${escapeHtml(s.estado)}</span>
            </div>

            <div class="request-meta">
              <span><strong>Solicitante:</strong> ${escapeHtml(sol.nombre_completo)} (${escapeHtml(sol.grado_grupo)})</span>
              <span><strong>WhatsApp:</strong> <a class="wa-link" href="${escapeHtml(buildWhatsappUrl(sol.telefono))}" target="_blank" rel="noopener noreferrer">${escapeHtml(sol.telefono)}</a></span>
              <span><strong>Fecha:</strong> ${escapeHtml(formatFecha(s.creado_en))}</span>
            </div>

            ${msgBlock}
            ${teamsGrid}
            ${actionsBlock}
          </article>`;
      })
      .join('');
  }

  function renderAdminParticipantes() {
    const container = $('admin-participantes-list');
    if (!container) return;

    const q = state.adminPartSearch.trim().toLowerCase();
    const list = state.adminData.participantes.filter((p) => {
      if (!q) return true;
      return (
        p.nombre_completo.toLowerCase().includes(q) ||
        p.grado_grupo.toLowerCase().includes(q) ||
        p.telefono.includes(q) ||
        (p.equipo_nombre || 'solitario').toLowerCase().includes(q)
      );
    });

    if (list.length === 0) {
      container.innerHTML = `<div class="empty-state">${q ? 'Sin resultados para esa búsqueda.' : 'Aún no hay participantes registrados.'}</div>`;
      return;
    }

    container.innerHTML = list
      .map((p) => {
        const equipoOptions = state.adminData.equipos
          .map((eq) => {
            const full = eq.total_integrantes >= MAX_POR_EQUIPO && eq.id !== p.equipo_id;
            const selected = eq.id === p.equipo_id ? 'selected' : '';
            const disabled = full ? 'disabled' : '';
            return `<option value="${escapeHtml(eq.id)}" ${selected} ${disabled}>${escapeHtml(eq.nombre)} (${eq.total_integrantes}/${MAX_POR_EQUIPO})</option>`;
          })
          .join('');

        return `
          <article class="participant-card" data-part-id="${escapeHtml(p.id)}">
            <div class="participant-main">
              <div>
                <strong>${escapeHtml(p.nombre_completo)}</strong>
                <span class="grade-pill">${escapeHtml(p.grado_grupo)}</span>
                ${p.pin_bloqueado ? '<span class="badge badge-red">PIN bloqueado</span>' : ''}
              </div>
              <div class="request-meta">
                <span>WhatsApp: <a class="wa-link" href="${escapeHtml(buildWhatsappUrl(p.telefono))}" target="_blank" rel="noopener noreferrer">${escapeHtml(p.telefono)}</a></span>
                <span>Equipo: <strong>${escapeHtml(p.equipo_nombre || 'Solitario')}</strong></span>
              </div>
            </div>

            <div class="participant-controls">
              <div class="move-group">
                <select class="admin-move-select" aria-label="Mover a ${escapeHtml(p.nombre_completo)}">
                  <option value="" ${!p.equipo_id ? 'selected' : ''}>Solitario (sin equipo)</option>
                  ${equipoOptions}
                </select>
                <button type="button" class="btn btn-outline btn-sm" data-admin-action="mover-part" data-part-id="${escapeHtml(p.id)}">
                  Guardar
                </button>
              </div>
              <button type="button" class="btn btn-outline btn-sm" data-admin-action="reset-pin" data-part-id="${escapeHtml(p.id)}" data-part-name="${escapeHtml(p.nombre_completo)}">
                Reset PIN
              </button>
              <button type="button" class="btn btn-danger-outline btn-sm" data-admin-action="eliminar-part" data-part-id="${escapeHtml(p.id)}" data-part-name="${escapeHtml(p.nombre_completo)}">
                Eliminar
              </button>
            </div>
          </article>`;
      })
      .join('');
  }

  function renderAdminEquipos() {
    const container = $('admin-equipos-list');
    if (!container) return;

    const list = state.adminData.equipos;
    if (list.length === 0) {
      container.innerHTML = '<div class="empty-state">No hay equipos registrados todavía.</div>';
      return;
    }

    container.innerHTML = list
      .map((eq) => {
        const isComplete = eq.total_integrantes >= MAX_POR_EQUIPO;
        const membersHtml = (eq.integrantes || [])
          .map(
            (m) => `
            <li class="member-item">
              <span class="member-name">${escapeHtml(m.nombre_completo)} <span class="grade-pill">${escapeHtml(m.grado_grupo)}</span></span>
              <a class="wa-link" href="${escapeHtml(buildWhatsappUrl(m.telefono))}" target="_blank" rel="noopener noreferrer">${escapeHtml(m.telefono)}</a>
            </li>`
          )
          .join('');

        return `
          <article class="squad-card ${isComplete ? 'squad-card-complete' : ''}">
            <div class="squad-card-head">
              <h3 class="squad-name">${escapeHtml(eq.nombre)}</h3>
              <span class="badge ${isComplete ? 'badge-green' : 'badge-amber'}">${eq.total_integrantes}/${MAX_POR_EQUIPO}</span>
            </div>
            <ul class="member-list">${membersHtml}</ul>
          </article>`;
      })
      .join('');
  }

  async function handleResolverSolicitud(solicitudId, accion, btn) {
    await setButtonBusy(btn, true, '...');
    try {
      const { data, error } = await state.supabase.rpc('admin_resolver_solicitud', {
        p_solicitud_id: solicitudId,
        p_accion: accion,
      });
      if (error) throw error;
      if (!data?.ok) {
        showToast(data?.error || 'No se pudo resolver la solicitud.', 'error');
        return;
      }
      showToast(data.mensaje || 'Solicitud actualizada.', 'success');
      await Promise.all([cargarDatosAdmin(false), cargarTableroPublico(false)]);
    } catch (err) {
      console.error('Error resolviendo solicitud:', err);
      showToast(err.message || 'Error al procesar la solicitud.', 'error');
    } finally {
      await setButtonBusy(btn, false);
    }
  }

  async function handleMoverParticipante(partId, nuevoEquipoId, btn) {
    await setButtonBusy(btn, true, '...');
    try {
      const { data, error } = await state.supabase.rpc('admin_mover_participante', {
        p_participante_id: partId,
        p_nuevo_equipo_id: nuevoEquipoId || null,
      });
      if (error) throw error;
      if (!data?.ok) {
        showToast(data?.error || 'No se pudo mover al participante.', 'error');
        return;
      }
      showToast(data.mensaje || 'Participante movido.', 'success');
      await Promise.all([cargarDatosAdmin(false), cargarTableroPublico(false)]);
    } catch (err) {
      console.error('Error moviendo participante:', err);
      showToast(err.message || 'Error al mover participante.', 'error');
    } finally {
      await setButtonBusy(btn, false);
    }
  }

  async function handleEliminarParticipante(partId, partName, btn) {
    const confirmado = window.confirm(
      `¿Seguro que deseas eliminar a "${partName}"? Esta acción no se puede deshacer y eliminará su equipo si queda vacío.`
    );
    if (!confirmado) return;

    await setButtonBusy(btn, true, '...');
    try {
      const { data, error } = await state.supabase.rpc('admin_eliminar_participante', {
        p_participante_id: partId,
      });
      if (error) throw error;
      if (!data?.ok) {
        showToast(data?.error || 'No se pudo eliminar al participante.', 'error');
        return;
      }
      showToast(data.mensaje || 'Participante eliminado.', 'success');
      await Promise.all([cargarDatosAdmin(false), cargarTableroPublico(false)]);
    } catch (err) {
      console.error('Error eliminando participante:', err);
      showToast(err.message || 'Error al eliminar participante.', 'error');
    } finally {
      await setButtonBusy(btn, false);
    }
  }

  function openModalResetPin(partId, partName) {
    state.modalContext.resetParticipanteId = partId;
    $('reset-pin-participante-nombre').textContent = `Participante: ${partName}`;
    $('reset-pin-nuevo').value = '';
    setAlert($('reset-pin-error'), null);
    openModal('modal-reset-pin');
  }

  async function handleResetPinSubmit(event) {
    event.preventDefault();
    const errEl = $('reset-pin-error');
    setAlert(errEl, null);

    const nuevoPin = sanitizeDigits($('reset-pin-nuevo').value);
    if (!/^\d{4}$/.test(nuevoPin)) {
      setAlert(errEl, 'El nuevo PIN debe tener exactamente 4 dígitos numéricos.', 'error');
      return;
    }

    const submitBtn = $('btn-reset-pin-submit');
    await setButtonBusy(submitBtn, true, 'Guardando...');

    try {
      const { data, error } = await state.supabase.rpc('admin_resetear_pin', {
        p_participante_id: state.modalContext.resetParticipanteId,
        p_nuevo_pin: nuevoPin,
      });
      if (error) throw error;
      if (!data?.ok) {
        setAlert(errEl, data?.error || 'No se pudo restablecer el PIN.', 'error');
        return;
      }

      closeModal('modal-reset-pin');
      showToast(data.mensaje || 'PIN restablecido.', 'success');
      await cargarDatosAdmin(false);
    } catch (err) {
      console.error('Error reseteando PIN:', err);
      setAlert(errEl, err.message || 'Error al restablecer el PIN.', 'error');
    } finally {
      await setButtonBusy(submitBtn, false);
    }
  }

  // =========================================================================
  // Exportación a Excel (.xlsx con SheetJS bajo demanda + fallback CSV)
  // =========================================================================

  function loadSheetJS() {
    if (window.XLSX) return Promise.resolve(window.XLSX);
    if (state.xlsxPromise) return state.xlsxPromise;

    state.xlsxPromise = new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = 'https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js';
      script.async = true;
      script.onload = () => {
        if (window.XLSX) resolve(window.XLSX);
        else reject(new Error('No se inicializó SheetJS.'));
      };
      script.onerror = () => reject(new Error('No se pudo descargar SheetJS.'));
      document.head.appendChild(script);
    });

    return state.xlsxPromise;
  }

  function downloadCsvFallback(rows, filename) {
    const headers = Object.keys(rows[0] || {});
    const escapeCell = (val) => `"${String(val ?? '').replace(/"/g, '""')}"`;
    const csv = [
      headers.map(escapeCell).join(','),
      ...rows.map((r) => headers.map((h) => escapeCell(r[h])).join(',')),
    ].join('\r\n');

    const blob = new Blob([`\uFEFF${csv}`], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  }

  async function exportarExcel() {
    if (!state.adminUnlocked) return;
    if (state.adminData.participantes.length === 0) {
      showToast('Aún no hay participantes para exportar.', 'info');
      return;
    }

    const btn = $('btn-export-excel');
    await setButtonBusy(btn, true, 'Generando...');

    const fechaHoy = new Date().toISOString().slice(0, 10);

    const rowsParticipantes = state.adminData.participantes.map((p) => ({
      'Nombre Completo': p.nombre_completo,
      'Grado y Grupo': p.grado_grupo,
      Teléfono: p.telefono,
      Estado: p.equipo_id ? 'En equipo' : 'Solitario',
      Equipo: p.equipo_nombre || '—',
      'Fecha de Registro': formatFecha(p.creado_en),
    }));

    const rowsEquipos = state.adminData.equipos.map((eq) => ({
      Equipo: eq.nombre,
      Integrantes: `${eq.total_integrantes}/${MAX_POR_EQUIPO}`,
      Estado: eq.total_integrantes >= MAX_POR_EQUIPO ? 'Completo' : 'Incompleto',
      Miembros: (eq.integrantes || [])
        .map((m) => `${m.nombre_completo} (${m.grado_grupo})`)
        .join(' | '),
      Teléfonos: (eq.integrantes || []).map((m) => m.telefono).join(' | '),
    }));

    const rowsSolitarios = state.adminData.participantes
      .filter((p) => !p.equipo_id)
      .map((p) => ({
        'Nombre Completo': p.nombre_completo,
        'Grado y Grupo': p.grado_grupo,
        Teléfono: p.telefono,
        'Fecha de Registro': formatFecha(p.creado_en),
      }));

    try {
      const XLSX = await loadSheetJS();
      const wb = XLSX.utils.book_new();

      const wsPart = XLSX.utils.json_to_sheet(rowsParticipantes);
      wsPart['!cols'] = [{ wch: 30 }, { wch: 15 }, { wch: 16 }, { wch: 13 }, { wch: 24 }, { wch: 20 }];
      XLSX.utils.book_append_sheet(wb, wsPart, 'Participantes');

      const wsEq = XLSX.utils.json_to_sheet(
        rowsEquipos.length ? rowsEquipos : [{ Equipo: 'Sin equipos registrados' }]
      );
      wsEq['!cols'] = [{ wch: 24 }, { wch: 14 }, { wch: 14 }, { wch: 52 }, { wch: 44 }];
      XLSX.utils.book_append_sheet(wb, wsEq, 'Equipos');

      const wsSolo = XLSX.utils.json_to_sheet(
        rowsSolitarios.length ? rowsSolitarios : [{ 'Nombre Completo': 'Sin participantes solitarios' }]
      );
      wsSolo['!cols'] = [{ wch: 30 }, { wch: 15 }, { wch: 16 }, { wch: 20 }];
      XLSX.utils.book_append_sheet(wb, wsSolo, 'Solitarios');

      XLSX.writeFile(wb, `Torneo_BO2_ISC_${fechaHoy}.xlsx`);
      showToast('Archivo Excel descargado.', 'success');
    } catch (err) {
      console.warn('Fallback a CSV por error cargando SheetJS:', err);
      downloadCsvFallback(rowsParticipantes, `Torneo_BO2_ISC_${fechaHoy}.csv`);
      showToast('Se descargó en formato CSV compatible con Excel.', 'info');
    } finally {
      await setButtonBusy(btn, false);
    }
  }

  // =========================================================================
  // Inicialización y Listeners
  // =========================================================================

  function bindEvents() {
    // Navegación principal
    document.querySelectorAll('.nav-tab').forEach((btn) => {
      btn.addEventListener('click', () => {
        switchTab(btn.dataset.tab);
      });
    });

    $('btn-refresh').addEventListener('click', async () => {
      await cargarTableroPublico(true);
      if (state.adminUnlocked && state.activeTab === 'admin') {
        await cargarDatosAdmin(false);
      }
    });

    $('btn-admin-toggle').addEventListener('click', () => {
      switchTab('admin');
      window.location.hash = 'admin';
    });

    window.addEventListener('hashchange', () => {
      if (window.location.hash === '#admin') {
        switchTab('admin');
      }
    });

    // Ergonomía de entradas de formulario
    $('reg-grado').addEventListener('input', (e) => {
      e.target.value = e.target.value.toUpperCase();
    });

    ['reg-telefono', 'reg-pin', 'sol-ind-pin', 'sol-fus-pin', 'salir-pin', 'reset-pin-nuevo'].forEach(
      (id) => {
        const input = $(id);
        if (input) {
          input.addEventListener('input', (e) => {
            e.target.value = sanitizeDigits(e.target.value);
          });
        }
      }
    );

    $('btn-toggle-reg-pin').addEventListener('click', () => {
      const pinInput = $('reg-pin');
      const showing = pinInput.type === 'text';
      pinInput.type = showing ? 'password' : 'text';
      $('btn-toggle-reg-pin').textContent = showing ? 'Mostrar' : 'Ocultar';
    });

    document.querySelectorAll('input[name="reg-modo"]').forEach((radio) => {
      radio.addEventListener('change', updateModoRegistroUI);
    });

    $('form-registro').addEventListener('submit', handleRegistroSubmit);

    // Tablero público: búsqueda, filtros y acciones delegadas
    $('tablero-busqueda').addEventListener('input', (e) => {
      state.boardSearch = e.target.value;
      renderTableroPublico();
    });

    document.querySelectorAll('[data-filter]').forEach((chip) => {
      chip.addEventListener('click', () => {
        state.boardFilter = chip.dataset.filter;
        document.querySelectorAll('[data-filter]').forEach((c) => {
          c.classList.toggle('active', c === chip);
        });
        renderTableroPublico();
      });
    });

    $('btn-abrir-salir').addEventListener('click', openModalSalirEquipo);

    $('tablero-contenido').addEventListener('click', (e) => {
      const btn = e.target.closest('[data-action]');
      if (!btn) return;
      const action = btn.dataset.action;
      const equipoId = btn.dataset.equipoId;

      if (action === 'solicitar-unirse') {
        openModalSolicitudIndividual(equipoId);
      } else if (action === 'solicitar-fusion') {
        openModalSolicitudFusion(equipoId);
      }
    });

    // Modales
    document.addEventListener('click', (e) => {
      const closeBtn = e.target.closest('[data-close-modal]');
      if (closeBtn) {
        closeModal(closeBtn.dataset.closeModal);
        return;
      }
      if (e.target.classList.contains('modal-backdrop')) {
        e.target.hidden = true;
      }
      const goRegBtn = e.target.closest('[data-action="ir-a-registro"]');
      if (goRegBtn) {
        closeAllModals();
        switchTab('registro');
        const radioSolitario = document.querySelector('input[name="reg-modo"][value="solitario"]');
        if (radioSolitario) {
          radioSolitario.checked = true;
          updateModoRegistroUI();
        }
        $('reg-nombre').focus();
      }
    });

    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') closeAllModals();
    });

    $('sol-ind-mensaje').addEventListener('input', (e) => {
      $('sol-ind-msg-count').textContent = String(e.target.value.length);
    });
    $('sol-fus-mensaje').addEventListener('input', (e) => {
      $('sol-fus-msg-count').textContent = String(e.target.value.length);
    });

    $('sol-fus-equipo-origen').addEventListener('change', () => {
      populateDependentMembers($('sol-fus-equipo-origen'), $('sol-fus-participante'));
    });

    $('salir-equipo-select').addEventListener('change', () => {
      populateDependentMembers($('salir-equipo-select'), $('salir-participante-select'));
    });

    $('form-solicitud-individual').addEventListener('submit', handleSolicitudIndividualSubmit);
    $('form-solicitud-fusion').addEventListener('submit', handleSolicitudFusionSubmit);
    $('form-salir-equipo').addEventListener('submit', handleSalirEquipoSubmit);

    // Panel Admin
    $('form-admin-login').addEventListener('submit', handleAdminLoginSubmit);
    $('btn-admin-logout').addEventListener('click', handleAdminLogout);
    $('btn-admin-refresh').addEventListener('click', () => cargarDatosAdmin(true));
    $('btn-export-excel').addEventListener('click', exportarExcel);

    document.querySelectorAll('[data-admin-tab]').forEach((btn) => {
      btn.addEventListener('click', () => {
        switchAdminSubtab(btn.dataset.adminTab);
      });
    });

    document.querySelectorAll('[data-sol-filter]').forEach((chip) => {
      chip.addEventListener('click', () => {
        state.adminSolFilter = chip.dataset.solFilter;
        document.querySelectorAll('[data-sol-filter]').forEach((c) => {
          c.classList.toggle('active', c === chip);
        });
        renderAdminSolicitudes();
      });
    });

    $('admin-part-busqueda').addEventListener('input', (e) => {
      state.adminPartSearch = e.target.value;
      renderAdminParticipantes();
    });

    $('admin-solicitudes-list').addEventListener('click', (e) => {
      const btn = e.target.closest('[data-admin-action]');
      if (!btn) return;
      const action = btn.dataset.adminAction;
      const solId = btn.dataset.solId;

      if (action === 'aceptar-sol') {
        handleResolverSolicitud(solId, 'aceptar', btn);
      } else if (action === 'rechazar-sol') {
        handleResolverSolicitud(solId, 'rechazar', btn);
      }
    });

    $('admin-participantes-list').addEventListener('click', (e) => {
      const btn = e.target.closest('[data-admin-action]');
      if (!btn) return;
      const action = btn.dataset.adminAction;
      const partId = btn.dataset.partId;

      if (action === 'mover-part') {
        const card = btn.closest('.participant-card');
        const select = card?.querySelector('.admin-move-select');
        handleMoverParticipante(partId, select ? select.value : null, btn);
      } else if (action === 'reset-pin') {
        openModalResetPin(partId, btn.dataset.partName || 'Participante');
      } else if (action === 'eliminar-part') {
        handleEliminarParticipante(partId, btn.dataset.partName || 'este participante', btn);
      }
    });

    $('form-reset-pin').addEventListener('submit', handleResetPinSubmit);
  }

  async function init() {
    if (!window.supabase?.createClient) {
      showToast('No se pudo cargar el cliente de Supabase.', 'error');
      return;
    }

    if (!CONFIG.SUPABASE_URL || !CONFIG.SUPABASE_PUBLISHABLE_KEY) {
      showToast('Falta configurar SUPABASE_URL y SUPABASE_PUBLISHABLE_KEY en config.js.', 'error');
      return;
    }

    state.supabase = window.supabase.createClient(
      CONFIG.SUPABASE_URL,
      CONFIG.SUPABASE_PUBLISHABLE_KEY
    );

    bindEvents();
    updateModoRegistroUI();

    if (window.location.hash === '#admin') {
      switchTab('admin');
    }

    await Promise.all([cargarTableroPublico(false), checkExistingAdminSession()]);
  }

  document.addEventListener('DOMContentLoaded', init);
})();
