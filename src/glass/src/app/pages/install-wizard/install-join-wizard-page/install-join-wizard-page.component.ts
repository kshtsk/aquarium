/*
 * Project Aquarium's frontend (glass)
 * Copyright (C) 2021 SUSE, LLC.
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU General Public License for more details.
 */
import { Component, OnInit, ViewChild } from '@angular/core';
import { MatStepper } from '@angular/material/stepper';
import { marker as TEXT } from '@biesbjerg/ngx-translate-extract-marker';
import _ from 'lodash';
import { BlockUI, NgBlockUI } from 'ng-block-ui';
import { concat } from 'rxjs';

import { translate } from '~/app/i18n.helper';
import { InstallWizardContext } from '~/app/pages/install-wizard/models/install-wizard-context.type';
import {
  LocalNodeService,
  NodeStatus,
  StatusStageEnum
} from '~/app/shared/services/api/local.service';
import { NodesService } from '~/app/shared/services/api/nodes.service';
import { NotificationService } from '~/app/shared/services/notification.service';
import { PollService } from '~/app/shared/services/poll.service';

type InstallJoinWizardContext = InstallWizardContext & {
  stage: 'unknown' | 'joining' | 'joined';
};

@Component({
  selector: 'glass-install-join-wizard-page',
  templateUrl: './install-join-wizard-page.component.html',
  styleUrls: ['./install-join-wizard-page.component.scss']
})
export class InstallJoinWizardPageComponent implements OnInit {
  @BlockUI()
  blockUI!: NgBlockUI;

  @ViewChild(MatStepper, { static: false })
  stepper?: MatStepper;

  public context: InstallJoinWizardContext = {
    config: {},
    stage: 'unknown',
    stepperVisible: false
  };
  public pageIndex = {
    start: 0,
    hostname: 1,
    devices: 2,
    registration: 3,
    summary: 4,
    finish: 5
  };

  constructor(
    private localNodeService: LocalNodeService,
    private nodesService: NodesService,
    private notificationService: NotificationService,
    private pollService: PollService
  ) {}

  ngOnInit(): void {
    this.blockUI.start(translate(TEXT(`Please wait, checking system status ...`)));
    this.localNodeService.status().subscribe(
      (res: NodeStatus) => {
        this.blockUI.stop();
        switch (res.node_stage) {
          case StatusStageEnum.joining:
            this.context.stage = 'joining';
            this.context.stepperVisible = false;
            // Jump to the 'Summary' step.
            this.stepper!.selectedIndex = this.pageIndex.summary;
            // Immediately show the progress message.
            this.blockUI.start(
              translate(TEXT('Please wait, joining existing cluster in progress ...'))
            );
            this.pollJoiningStatus();
            break;
          case StatusStageEnum.ready:
            this.context.stage = 'joined';
            this.context.stepperVisible = true;
            // Jump to the 'Finish' step.
            this.stepper!.selectedIndex = this.pageIndex.finish;
            break;
          default:
            this.context.stepperVisible = true;
            // Force linear mode.
            this.stepper!.linear = true;
            break;
        }
      },
      (err) => this.handleError(err.message)
    );
  }

  onAnimationDone(): void {
    // Focus the first element with the 'autofocus' attribute.
    if (this.stepper) {
      // eslint-disable-next-line no-underscore-dangle
      const stepContentId = this.stepper._getStepContentId(this.stepper.selectedIndex);
      const stepContentElement = document.getElementById(stepContentId);
      const element: HTMLElement | null | undefined = stepContentElement?.querySelector(
        '[ng-reflect-autofocus=true]'
      );
      if (element && _.isFunction(element.focus)) {
        element.focus();
      }
    }
  }

  doJoin(): void {
    this.context.stage = 'joining';
    this.context.stepperVisible = false;
    this.blockUI.start(translate(TEXT('Please wait, start joining existing cluster ...')));
    concat(
      this.nodesService.setHostname(this.context.config.hostname),
      this.nodesService.join({
        address: `${this.context.config.address}:${this.context.config.port}`,
        token: this.context.config.token
      })
    ).subscribe({
      next: (success: boolean) => {
        if (success) {
          this.blockUI.update(
            translate(TEXT('Please wait, joining existing cluster in progress ...'))
          );
          this.pollJoiningStatus();
        } else {
          this.handleError(TEXT('Failed to join existing cluster.'));
        }
      },
      error: (err) => this.handleError(err.message)
    });
  }

  private handleError(err: any): void {
    this.context.stepperVisible = true;
    this.blockUI.stop();
    this.notificationService.show(err.toString(), {
      type: 'error'
    });
  }

  private pollJoiningStatus(): void {
    this.localNodeService
      .status()
      .pipe(
        this.pollService.poll(
          (res: NodeStatus) => res.node_stage === StatusStageEnum.joining,
          undefined,
          TEXT('Failed to join existing cluster.')
        )
      )
      .subscribe(
        (res: NodeStatus) => {
          switch (res.node_stage) {
            case StatusStageEnum.none:
            case StatusStageEnum.unknown:
              this.context.stage = 'unknown';
              this.handleError(TEXT('Failed to join existing cluster.'));
              break;
            case StatusStageEnum.ready:
              this.context.stage = 'joined';
              this.context.stepperVisible = true;
              this.blockUI.stop();
              this.stepper?.next();
              break;
          }
        },
        (err) => this.handleError(err.message)
      );
  }
}
