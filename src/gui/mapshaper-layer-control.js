/* @require mapshaper-gui-lib mapshaper-dom-cache mapshaper-layer-sorting */

function LayerControl(model, map) {
  var el = El("#layer-control").on('click', gui.handleDirectEvent(gui.clearMode));
  var buttonLabel = El('#layer-control-btn .layer-name');
  var isOpen = false;
  var cache = new DomCache();
  var pinAll = El('#pin-all'); // button for toggling layer visibility

  // layer repositioning
  var dragTargetId = null;
  var dragging = false;
  var layerOrderSlug;

  new ModeButton('#layer-control-btn .header-btn', 'layer_menu');
  gui.addMode('layer_menu', turnOn, turnOff);
  model.on('update', function(e) {
    updateMenuBtn();
    if (isOpen) render();
  });

  el.on('mouseup', stopDragging);
  el.on('mouseleave', stopDragging);

  // init layer visibility button
  pinAll.on('click', function() {
    var allOn = testAllLayersPinned();
    model.forEachLayer(function(lyr, dataset) {
      if (allOn) {
        map.removeReferenceLayer(lyr);
      } else {
        map.addReferenceLayer(lyr, dataset);
      }
    });
    El.findAll('.pinnable', el.node()).forEach(function(item) {
      El(item).classed('pinned', !allOn);
    });
    map.redraw();
  });


  function updatePinAllButton() {
    pinAll.classed('pinned', testAllLayersPinned());
  }

  function testAllLayersPinned() {
    var yes = true;
    model.forEachLayer(function(lyr, dataset) {
      if (isPinnable(lyr) && !map.isReferenceLayer(lyr) && !map.isActiveLayer(lyr)) {
        yes = false;
      }
    });
    return yes;
  }

  function findLayerById(id) {
    return model.findLayer(function(lyr, dataset) {
      return lyr.menu_id == id;
    });
  }

  function getLayerOrderSlug() {
    return internal.sortLayersForMenuDisplay(model.getLayers()).map(function(o) {
      return map.isVisibleLayer(o.layer) ? o.layer.menu_id : '';
    }).join('');
  }

  function clearClass(name) {
    var targ = el.findChild('.' + name);
    if (targ) targ.removeClass(name);
  }

  function stopDragging() {
    clearClass('drag-target');
    clearClass('insert-above');
    clearClass('insert-below');
    dragTargetId = layerOrderSlug = null;
    if (dragging) {
      render(); // in case menu changed...
      dragging = false;
    }
  }

  function insertLayer(dragId, dropId, above) {
    var dragLyr = findLayerById(dragId);
    var dropLyr = findLayerById(dropId);
    var slug;
    if (dragId == dropId) return;
    dragLyr.layer.stack_id = dropLyr.layer.stack_id + (above ? 0.5 : -0.5);
    slug = getLayerOrderSlug();
    if (slug != layerOrderSlug) {
      layerOrderSlug = slug;
      map.redraw();
    }
  }

  function turnOn() {
    isOpen = true;
    El('#layer-control div.info-box-scrolled').css('max-height', El('body').height() - 80);
    render();
    el.show();
  }

  function turnOff() {
    isOpen = false;
    el.hide();
  }

  function updateMenuBtn() {
    var name = model.getActiveLayer().layer.name || "[unnamed layer]";
    buttonLabel.html(name + " &nbsp;&#9660;");
  }

  function render() {
    var list = El('#layer-control .layer-list');
    var uniqIds = {};
    var pinnableCount = 0;
    list.empty();
    model.forEachLayer(function(lyr, dataset) {
      // Assign a unique id to each layer, so html strings
      // can be used as unique identifiers for caching rendered HTML, and as
      // an id for layer menu event handlers
      if (!lyr.menu_id || uniqIds[lyr.menu_id]) {
        lyr.menu_id = utils.getUniqueName();
      }
      uniqIds[lyr.menu_id] = true;
      if (isPinnable(lyr)) pinnableCount++;
    });

    if (pinnableCount < 2) {
      pinAll.hide();
    } else {
      pinAll.show();
      updatePinAllButton();
    }

    internal.sortLayersForMenuDisplay(model.getLayers()).forEach(function(o) {
      var lyr = o.layer;
      var pinnable = pinnableCount > 1 && isPinnable(lyr);
      var html, element;
      html = renderLayer(lyr, o.dataset, pinnable);
      if (cache.contains(html)) {
        element = cache.use(html);
      } else {
        element = El('div').html(html).firstChild();
        initMouseEvents(element, lyr.menu_id, pinnable);
        cache.add(html, element);
      }
      list.appendChild(element);
    });
  }

  cache.cleanup();

  function renderLayer(lyr, dataset, pinnable) {
    var warnings = getWarnings(lyr, dataset);
    var classes = 'layer-item';
    var entry, html;

    if (pinnable) classes += ' pinnable';
    if (map.isActiveLayer(lyr)) classes += ' active';
    if (map.isReferenceLayer(lyr)) classes += ' pinned';

    html = '<!-- ' + lyr.menu_id + '--><div class="' + classes + '">';
    html += rowHTML('name', '<span class="layer-name colored-text dot-underline">' + getDisplayName(lyr.name) + '</span>', 'row1');
    html += rowHTML('source file', describeSrc(lyr, dataset) || 'n/a');
    html += rowHTML('contents', describeLyr(lyr));
    if (warnings) {
      html += rowHTML('problems', warnings, 'layer-problems');
    }
    html += '<img class="close-btn" draggable="false" src="images/close.png">';
    if (pinnable) {
      html += '<img class="pin-btn unpinned" draggable="false" src="images/eye.png">';
      html += '<img class="pin-btn pinned" draggable="false" src="images/eye2.png">';
    }
    html += '</div>';
    return html;
  }

  function initMouseEvents(entry, id, pinnable) {
    entry.on('mouseover', init);
    function init() {
      entry.removeEventListener('mouseover', init);
      initMouseEvents2(entry, id, pinnable);
    }
  }

  function initLayerDragging(entry, id) {
    var rect;

    // support layer drag-drop
    entry.on('mousemove', function(e) {
      if (!e.buttons && (dragging || dragTargetId)) { // button is up
        stopDragging();
      }
      if (e.buttons && !dragTargetId) {
        dragTargetId = id;
        entry.addClass('drag-target');
      }
      if (!dragTargetId) {
        return;
      }
      if (dragTargetId != id) {
        // signal to redraw menu later; TODO: improve
        dragging = true;
      }
      rect = entry.node().getBoundingClientRect();
      var y = e.pageY - rect.top;
      if (y < rect.height / 2) {
        if (!entry.hasClass('insert-above')) {
          clearClass('dragging');
          clearClass('insert-above');
          clearClass('insert-below');
          entry.addClass('dragging');
          entry.addClass('insert-above');
          insertLayer(dragTargetId, id, true);
        }
      } else {
        if (!entry.hasClass('insert-below')) {
          clearClass('dragging');
          clearClass('insert-above');
          clearClass('insert-below');
          entry.addClass('insert-below');
          entry.addClass('dragging');
          insertLayer(dragTargetId, id, false);
        }
      }
    });
  }

  function initMouseEvents2(entry, id, pinnable) {

    initLayerDragging(entry, id);

    // init delete button
    gui.onClick(entry.findChild('img.close-btn'), function(e) {
      var target = findLayerById(id);
      e.stopPropagation();
      if (map.isReferenceLayer(target.layer)) {
        // TODO: check for double map refresh after model.deleteLayer() below
        map.removeReferenceLayer(target.layer);
      }
      model.deleteLayer(target.layer, target.dataset);
    });

    if (pinnable) {
      // init pin button
      gui.onClick(entry.findChild('img.unpinned'), function(e) {
        var target = findLayerById(id);
        e.stopPropagation();
        if (entry.hasClass('active')) {
          return; // selected layer
        }
        if (map.isReferenceLayer(target.layer)) {
          map.removeReferenceLayer(target.layer);
          entry.removeClass('pinned');
        } else {
          map.addReferenceLayer(target.layer, target.dataset);
          entry.addClass('pinned');
        }
        updatePinAllButton();
        map.redraw();
      });

      // catch click event
      gui.onClick(entry.findChild('img.unpinned'), function(e) {
        e.stopPropagation();
      });
    }

    // init name editor
    new ClickText2(entry.findChild('.layer-name'))
      .on('change', function(e) {
        var target = findLayerById(id);
        var str = cleanLayerName(this.value());
        this.value(getDisplayName(str));
        target.layer.name = str;
        updateMenuBtn();
      });

    // init click-to-select
    gui.onClick(entry, function() {
      var target = findLayerById(id);
      // don't select if user is typing or dragging
      if (!gui.getInputElement() && !dragTargetId) {
        gui.clearMode();
        if (!map.isActiveLayer(target.layer)) {
          model.updated({select: true}, target.layer, target.dataset);
        }
      }
    });
  }

  function describeLyr(lyr) {
    var n = internal.getFeatureCount(lyr),
        str, type;
    if (lyr.data && !lyr.shapes) {
      type = 'data record';
    } else if (lyr.geometry_type) {
      type = lyr.geometry_type + ' feature';
    }
    if (type) {
      str = utils.format('%,d %s%s', n, type, utils.pluralSuffix(n));
    } else {
      str = "[empty]";
    }
    return str;
  }

  function getWarnings(lyr, dataset) {
    var file = getSourceFile(lyr, dataset);
    var missing = [];
    var msg;
    if (utils.endsWith(file, '.shp') && lyr == dataset.layers[0]) {
      if (!lyr.data) {
        missing.push('.dbf');
      }
      if (!dataset.info.prj && !dataset.info.crs) {
        missing.push('.prj');
      }
    }
    if (missing.length) {
      msg = 'missing ' + missing.join(' and ') + ' data';
    }
    return msg;
  }

  function getSourceFile(lyr, dataset) {
    var inputs = dataset.info.input_files;
    return inputs && inputs[0] || '';
  }

  function describeSrc(lyr, dataset) {
    return getSourceFile(lyr, dataset);
  }

  function getDisplayName(name) {
    return name || '[unnamed]';
  }

  function isPinnable(lyr) {
    return internal.layerHasGeometry(lyr);
  }


  function cleanLayerName(raw) {
    return raw.replace(/[\n\t/\\]/g, '')
      .replace(/^[\.\s]+/, '').replace(/[\.\s]+$/, '');
  }

  function rowHTML(c1, c2, cname) {
    return utils.format('<div class="row%s"><div class="col1">%s</div>' +
      '<div class="col2">%s</div></div>', cname ? ' ' + cname : '', c1, c2);
  }
}
