//-- copyright
// OpenProject is an open source project management software.
// Copyright (C) the OpenProject GmbH
//
// This program is free software; you can redistribute it and/or
// modify it under the terms of the GNU General Public License version 3.
//
// OpenProject is a fork of ChiliProject, which is a fork of Redmine. The copyright follows:
// Copyright (C) 2006-2013 Jean-Philippe Lang
// Copyright (C) 2010-2013 the ChiliProject Team
//
// This program is free software; you can redistribute it and/or
// modify it under the terms of the GNU General Public License
// as published by the Free Software Foundation; either version 2
// of the License, or (at your option) any later version.
//
// This program is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU General Public License for more details.
//
// You should have received a copy of the GNU General Public License
// along with this program; if not, write to the Free Software
// Foundation, Inc., 51 Franklin Street, Fifth Floor, Boston, MA  02110-1301, USA.
//
// See COPYRIGHT and LICENSE files for more details.
//++

import {
  monitorForElements,
  type ElementEventPayloadMap,
} from '@atlaskit/pragmatic-drag-and-drop/element/adapter';
import { Controller } from '@hotwired/stimulus';
import { FetchRequest } from '@rails/request.js';
import { debugLog } from 'core-app/shared/helpers/debug_output';
import { OPToastEvent } from 'core-app/shared/components/toaster/toast-event';
import { flipMove } from 'core-stimulus/helpers/flip-helper';
import { parseTemplate } from 'url-template';
import {
  buildMoveFormData,
  isSortableItemData,
  resolveDropIntent,
  type RootAwareChild,
  type SortableListData,
  type SortableListsRoot,
} from './sortable-lists/drag-and-drop';
import {
  captureRowPositions,
  reorderRows,
  resolveDirectionalPreviousItemId,
  resolveItemId,
  resolveItemMovePosition,
  restoreRowPositions,
  rowOf,
  rowsRemainAt,
  sortableListsBusyAttribute,
  type MoveDirection,
} from './sortable-lists/list-dom';

type CleanupFn = () => void;
type ElementDropPayload = ElementEventPayloadMap['onDrop'];
type MoveResult = { ok:true }|{ ok:false; showToast:boolean };

export default class SortableListsController extends Controller<HTMLElement> implements SortableListsRoot {
  static outlets = ['sortable-lists--list', 'sortable-lists--item', 'sortable-lists--scrollable'];

  static values = {
    moveUrlTemplate: String,
  };

  declare readonly sortableListsListOutlets:import('./sortable-lists/list.controller').default[];
  declare readonly sortableListsItemOutlets:RootAwareChild[];

  declare readonly moveUrlTemplateValue:string;
  declare readonly hasMoveUrlTemplateValue:boolean;

  private monitorCleanupFn?:CleanupFn;

  connect():void {
    this.monitorCleanupFn = monitorForElements({
      canMonitor: ({ source }) => !this.busy
        && isSortableItemData(source.data)
        && source.data.rootElement === this.element,
      onDrop: (args) => {
        void this.handleDrop(args);
      },
    });
  }

  disconnect():void {
    this.monitorCleanupFn?.();
    this.monitorCleanupFn = undefined;
  }

  sortableListsListOutletConnected(list:RootAwareChild):void {
    list.connectRoot(this);
  }

  sortableListsListOutletDisconnected(list:RootAwareChild):void {
    list.disconnectRoot();
  }

  sortableListsItemOutletConnected(item:RootAwareChild):void {
    item.connectRoot(this);
  }

  sortableListsItemOutletDisconnected(item:RootAwareChild):void {
    item.disconnectRoot();
  }

  sortableListsScrollableOutletConnected(scrollable:RootAwareChild):void {
    scrollable.connectRoot(this);
  }

  sortableListsScrollableOutletDisconnected(scrollable:RootAwareChild):void {
    scrollable.disconnectRoot();
  }

  get busy():boolean {
    return this.element.hasAttribute(sortableListsBusyAttribute);
  }

  itemMovePosition(itemElement:HTMLElement):{ isFirst:boolean; isLast:boolean }|null {
    const list = this.ownerListOf(itemElement);

    return list ? resolveItemMovePosition({ itemElement, rowsContainer: list.rowsContainer }) : null;
  }

  // Availability mirrors executability: a direction is offered exactly when the
  // move resolver can produce a target for it. This keeps the menu honest about
  // truncated lists, where a one-step move across the hidden block is not
  // addressable and the resolver returns undefined.
  directionalMoveAvailable(itemElement:HTMLElement, direction:MoveDirection):boolean {
    const list = this.ownerListOf(itemElement);
    if (!list) {
      return false;
    }

    return resolveDirectionalPreviousItemId({ itemElement, direction, rowsContainer: list.rowsContainer }) !== undefined;
  }

  moveInDirection(itemElement:HTMLElement, direction:MoveDirection):void {
    if (this.busy) {
      return;
    }

    const list = this.ownerListOf(itemElement);
    if (!list) {
      return;
    }

    const itemId = resolveItemId(itemElement);
    if (!itemId) {
      return;
    }

    const previousItemId = resolveDirectionalPreviousItemId({ itemElement, direction, rowsContainer: list.rowsContainer });
    if (previousItemId === undefined) {
      return;
    }

    const moveUrl = this.resolveMoveUrl({ itemId });
    const sourceRow = rowOf(list.rowsContainer, itemElement);
    if (!moveUrl || !sourceRow) {
      return;
    }

    void this.performMove({
      sourceRow,
      rowsContainer: list.rowsContainer,
      listData: list.listData,
      previousItemId,
      moveUrl,
    });
  }

  private ownerListOf(itemElement:HTMLElement) {
    return this.sortableListsListOutlets.find((list) => list.element.contains(itemElement)) ?? null;
  }

  private async handleDrop({ location, source }:ElementDropPayload) {
    if (this.busy) {
      debugLog('sortable-lists: ignoring drop, a move is already in progress');
      return;
    }

    if (!isSortableItemData(source.data) || !(source.element instanceof HTMLElement)) {
      debugLog('sortable-lists: ignoring drop, source is not a sortable item', source.data);
      return;
    }

    if (!this.element.contains(source.element)) {
      debugLog('sortable-lists: ignoring drop, source does not belong to this root');
      return;
    }

    const moveUrl = this.resolveMoveUrl(source.data);
    if (!moveUrl) {
      debugLog('sortable-lists: ignoring drop, no move URL for item', source.data.itemId);
      return;
    }

    const intent = resolveDropIntent({
      location,
      root: this.element,
      sourceElement: source.element,
      sourceData: source.data,
    });
    if (!intent) {
      debugLog('sortable-lists: ignoring drop, it did not resolve to a move '
        + '(dropped outside a list or back onto its original position)');
      return;
    }

    // The dragged source row is still resolved as an <li>, the one place the
    // subsystem is not yet tag-agnostic: reaching its rows container structurally
    // needs the source list (not the root) on the item payload. Backlogs rows are
    // <li>, so this holds today; generalising it is a tracked follow-up.
    const sourceRow = source.element.closest('li');
    if (!(sourceRow instanceof HTMLElement)) {
      debugLog('sortable-lists: ignoring drop, could not resolve the source row element');
      return;
    }

    await this.performMove({
      sourceRow,
      rowsContainer: intent.rowsContainer,
      listData: intent.listData,
      previousItemId: intent.previousItemId,
      moveUrl,
    });
  }

  // Optimistically reorder a single row, persist the move, and roll the row
  // back (with a FLIP animation and an error toast) if the server rejects it.
  // Shared by drag drops and programmatic menu moves.
  private async performMove({
    sourceRow,
    rowsContainer,
    listData,
    previousItemId,
    moveUrl,
  }:{
    sourceRow:HTMLElement;
    rowsContainer:HTMLElement;
    listData:SortableListData;
    previousItemId:string|null;
    moveUrl:string;
  }):Promise<void> {
    const rows = [sourceRow];
    const rollback = captureRowPositions(rows);
    reorderRows({ rows, rowsContainer, previousItemId });
    const optimisticPlacement = captureRowPositions(rows);

    const result = await this.moveItem({ listData, previousItemId, moveUrl });

    if (!result.ok) {
      try {
        // A concurrent morph that removed or repositioned the rows carries
        // fresher server state than the pre-move snapshot; roll back only
        // while the rows still sit where the optimistic move put them.
        if (rowsRemainAt(optimisticPlacement)) {
          flipMove(rows, () => restoreRowPositions(rollback));
        }
      } catch (error) {
        debugLog('Failed to roll back sortable list item move', error);
      }

      if (result.showToast) {
        this.dispatchErrorToast();
      }
    }
  }

  private resolveMoveUrl(data:{ itemId:string }):string|null {
    if (!this.hasMoveUrlTemplateValue) {
      return null;
    }

    const expanded = parseTemplate(this.moveUrlTemplateValue).expand({ id: data.itemId });
    const url = new URL(expanded, window.location.href);
    // Both drag and menu moves share this path and are flagged optimistic=true
    // (the move is already applied in the DOM), so the server skips the frame
    // reload for a same-list move.
    url.searchParams.set('optimistic', 'true');

    return `${url.pathname}${url.search}${url.hash}`;
  }

  private async moveItem({
    listData,
    previousItemId,
    moveUrl,
  }:{
    listData:SortableListData;
    previousItemId:string|null;
    moveUrl:string;
  }):Promise<MoveResult> {
    const request = new FetchRequest(
      'put',
      moveUrl,
      {
        body: buildMoveFormData({
          listId: listData.listId,
          previousItemId,
          type: listData.type,
        }),
        responseKind: 'turbo-stream',
      },
    );

    this.setBusy(true);
    try {
      const response = await request.perform();

      if (!response.ok) {
        debugLog(`Failed to move sortable list item: ${response.statusCode}`);
      }

      return response.ok
        ? { ok: true }
        : { ok: false, showToast: response.statusCode !== 422 };
    } catch (error) {
      debugLog('Failed to move sortable list item due to request error', error);
      return { ok: false, showToast: true };
    } finally {
      this.setBusy(false);
    }
  }

  private setBusy(busy:boolean):void {
    if (busy) {
      this.element.setAttribute(sortableListsBusyAttribute, 'true');
    } else {
      this.element.removeAttribute(sortableListsBusyAttribute);
    }
    this.sortableListsListOutlets.forEach((list) => list.reflectBusy(busy));
  }

  private dispatchErrorToast():void {
    window.dispatchEvent(new CustomEvent(OPToastEvent, {
      detail: {
        message: I18n.t('js.error.internal'),
        type: 'error',
      },
    }));
  }
}
