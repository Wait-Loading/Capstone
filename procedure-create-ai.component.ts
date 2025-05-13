/* eslint-disable @stylistic/padded-blocks */
/* eslint-disable @stylistic/brace-style */
/* eslint-disable @stylistic/keyword-spacing */
/* eslint-disable @typescript-eslint/explicit-member-accessibility */
/* eslint-disable @stylistic/indent */
import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormControl, FormGroup, FormsModule, ReactiveFormsModule, ValidationErrors, Validators } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { UntilDestroy } from '@ngneat/until-destroy';
import hljs from 'highlight.js';
import { ConfirmationService } from 'primeng/api';
import { DialogModule } from 'primeng/dialog';
import { MessageModule } from 'primeng/message';
import { QuillModule } from 'ngx-quill';
import { RichTextEditorTool } from '../../shared-lazy/rich-text-editor-toolbar/rich-text-editor-toolbar.component';
import { ResponsiveDialogService } from '../../core/services/responsive-dialog.service';
import { ViewPortService } from '../../core/services/view-port.service';
import { SharedLazyModule } from '../../shared-lazy/shared-lazy.module';
import { ProcedureFromDocumentService } from '../../core/services/procedure-from-document.service';
import { validateFormControlByteSize } from '../../core/methods/form-validation/validate-form-control-string-byte-size.method';
import { RichTextEditorBaseComponent } from '../../shared-lazy/rich-text-editor-base-component/rich-text-editor-base-component';
import { LibraryRoutingPaths } from '../../app-routing.module';
import { TextGenerationService } from '../../core/services/text-generation.service';
import { ProcedureMutationsService } from '../../core/gql-operations/procedure/procedure-mutations.service';
import { IProcedureCreate_RequestVariables } from '../../core/gql-operations/procedure/procedure-create.mutation';
import { lastValueFrom } from 'rxjs';
import { IProcedureStepInput } from '@tasktrain/shared';

interface ProcedureStepInput {
  stepIndex: number;
  name: string;
  description: string;
  stepType?: string;
}

@UntilDestroy()
@Component({
  selector: 'tt-procedure-create-ai',
  templateUrl: 'procedure-create-ai.component.html',
  styleUrls: ['procedure-create-ai.component.scss'],
  standalone: true,
  imports: [DialogModule, FormsModule, ReactiveFormsModule, QuillModule, CommonModule, SharedLazyModule, MessageModule],
})
export class ProcedureCreateAiComponent extends RichTextEditorBaseComponent implements OnInit {
  public editorFormControl = new FormControl<string>('', [
    Validators.required,
    validateFormControlByteSize(16 * 1000 * 1000),
    this.validateFormControlOutlineMarkup.bind(this),
  ]);
  public editorForm: FormGroup = new FormGroup({
    editor: this.editorFormControl,
  });

  public richTextEditorModules = {
    'syntax': { hljs: hljs },
    'emoji-toolbar': true,
    'emoji-textarea': false,
    'emoji-shortname': true,
  };

  public toolbarEnabledToolList = [
    RichTextEditorTool.StyleGroup,
    RichTextEditorTool.FormatGroup,
    RichTextEditorTool.ListGroup,
    RichTextEditorTool.IndentationGroup,
    RichTextEditorTool.BaselineGroup,
    RichTextEditorTool.ColorGroup,
    RichTextEditorTool.AlignGroup,
    RichTextEditorTool.EmbedGroup,
    RichTextEditorTool.emoji,
    RichTextEditorTool.clean,
    RichTextEditorTool.GenerateText,
  ];

  public waitingForServer = false;
  public display = true;
	public messages: {
		sender: string;
		text: string;
		type?: 'text' | 'button' | 'dual-button';
	}[] = [];

		public chatInput: string = '';
  public isBotTyping: boolean = false;
  public generatedProcedure: string = '';
  public secondLastMessage: string = '';
  public static isjson = false;

  private accountId: string;
  private manualId: string;

  constructor(
    private viewRouter: Router,
    private activeViewRoute: ActivatedRoute,
    private confirmationService: ConfirmationService,
    private procedureFromDocumentService: ProcedureFromDocumentService,
    public responsiveDialogService: ResponsiveDialogService,
    public viewPortService: ViewPortService,
    private textGenerationService: TextGenerationService,
    private procedureMutationsService: ProcedureMutationsService
  ) {
    super();
  }

  public ngOnInit(): void {
    this.accountId = this.activeViewRoute.snapshot.paramMap.get('accountId') || '';
    this.manualId = this.activeViewRoute.snapshot.paramMap.get('manualId') || '';
    TextGenerationService.isprocedure = false;
    if (ProcedureCreateAiComponent.isjson) {
      TextGenerationService.isprocedure_2 = true;
    } else {
      TextGenerationService.isprocedure_2 = false;
    }

    const intro = "Welcome! Please describe the procedure you would like to create. I'll ask you a few follow-up questions to help refine the details.";
    this.messages.push({ sender: 'SYSTEM', text: intro });
  }
	async sendMessage(): Promise<void>  {
		this.scrollToBottom();

		if (this.isBotTyping || !this.chatInput.trim()) return;
		this.messages.push({ sender: 'user', text: this.chatInput });
		this.isBotTyping = true;

		// Prepare the input message for generation
		let messageToSend = this.chatInput;

		// If in edit mode, include the second last bot message as context
		if (this.textGenerationService.edit && this.secondLastMessage) {
			const editedProcedure = await this.textGenerationService.editGeneratedText(
				this.secondLastMessage,
				this.chatInput
			);

      // Use the edited procedure as the message to send
      let messageToSend = editedProcedure;

      // Reset edit mode after successful edit
      this.textGenerationService.edit = false;
			this.messages.push({ sender: 'bot', text: editedProcedure });
			if (TextGenerationService.isprocedure) {
				this.messages.push({
					sender: 'bot',
					text: 'What would you like to create the procedure in task train or give prompt to edit the procedure more ?',
					type: 'dual-button'
				});



			}
			this.isBotTyping = false;

			return
			}

		this.textGenerationService.generateProcedure2(messageToSend).then(response => {
			this.generatedProcedure = response;
			this.messages.push({ sender: 'bot', text: response });

			const botMessages = this.messages.filter(msg => msg.sender === 'bot' && msg.text !== 'Create Procedure');
			if (botMessages.length > 1) {
				this.secondLastMessage = botMessages[botMessages.length - 1].text;
			}

			if (TextGenerationService.isprocedure) {
				this.messages.push({
					sender: 'bot',
					text: ' would you like to create the procedure in task train or give prompt to edit the procedure more ?',
					type: 'dual-button'
				});


			}

			this.isBotTyping = false;
			this.scrollToBottom();
		}).catch(() => {
			this.messages.push({ sender: 'bot', text: 'Sorry, there was an issue generating the response.' });
			this.isBotTyping = false;
		});

		this.chatInput = '';
	}


  private scrollToBottom(): void {
    setTimeout(() => {
      const chatBody = document.querySelector('.chatbot-body');
      if (chatBody) {
        chatBody.scrollTop = chatBody.scrollHeight;
      }
    }, 100);
  }

  public onCreateButtonPress(): void {
    this.editorFormControl.setValue(this.secondLastMessage);

    if (ProcedureCreateAiComponent.isjson) {
      ProcedureCreateAiComponent.isjson = false;
      this.createProcedureFromJson();
      return;
    }

    const headingMarkup = /<(h[1-6])\b[^>]*>/i;
    const listMarkup = /<(ol|ul)\b[^>]*>/i;

    if (headingMarkup.test(this.editorFormControl.value) && listMarkup.test(this.editorFormControl.value)) {
      this.confirmationService.confirm({
        message: `Document includes both Heading and List formatting.
          Create Procedure Steps from both headings and list items?`,
        header: 'Treat Both Headings and List Items as Steps?',
        icon: 'tt-icon-attention',
        acceptLabel: 'Both',
        acceptButtonStyleClass: 'tt-btn-create',
        acceptIcon: 'tt-icon-create',
        accept: (): void => {
          this.createProcedure(true);
        },
        rejectLabel: 'Headings Only',
        rejectButtonStyleClass: 'tt-btn-create',
        rejectIcon: 'tt-icon-create',
        reject: (): void => {
          this.createProcedure(false);
        },
      });
    } else {
      this.createProcedure(true);
    }
  }

  private createProcedure(includeLists: boolean): void {
    this.procedureFromDocumentService.createProcedureFromDocument(
      this.editorFormControl.value,
      this.accountId,
      this.manualId,
      includeLists
    ).subscribe({
      next: ({ data: { ProcedureCreate } }) => {
        void this.viewRouter.navigate(
          [{
            outlets: {
              dialog: null,
              primary: [this.manualId, LibraryRoutingPaths.Procedures, ProcedureCreate._id, LibraryRoutingPaths.Steps],
            },
          }],
          { relativeTo: this.activeViewRoute.parent.parent }
        );

        this.resetChat();
      },
      error: (error) => {
        console.error('Error creating procedure:', error);
        this.messages.push({
          sender: 'bot',
          text: 'Failed to create procedure from document'
        });
      }
    });
  }

  public onCancelOrDiscardButtonPress(): void {
    if (this.editorForm.dirty) {
      this.confirmationService.confirm({
        message: 'Discard changes?',
        header: 'Confirm Discard',
        icon: 'tt-icon-attention',
        rejectLabel: 'Cancel',
        acceptLabel: 'Discard',
        accept: (): void => {
          this.closeDialog();
        },
      });
    } else {
      this.closeDialog();
    }
  }

  public onCloseDialog(): void {
    TextGenerationService.userResponses = null;
    TextGenerationService.isprocedure = false;
		this.textGenerationService.edit = false;
    this.messages = [];
    ProcedureCreateAiComponent.isjson = false;
    this.closeDialog();
  }

  private closeDialog(): void {
		TextGenerationService.userResponses = null;

    void this.viewRouter.navigate(
      [{ outlets: { dialog: null } }],
      { relativeTo: this.activeViewRoute.parent.parent, queryParamsHandling: 'preserve' }
    );
  }

  private validateFormControlOutlineMarkup(formControl: FormControl): ValidationErrors | null {
    const outlineMarkup = /<(h[1-6]|ol|ul)\b[^>]*>/i;
    return outlineMarkup.test(formControl.value) ? null : { outlineMarkup: 'Text does not contain any outline formatting' };
  }

  public onEditButtonPress(): void {
    this.messages.push({
      sender: 'bot',
      text: 'What changes would you like to make to the procedure?',
    });
  }

  public handleButtonPress(text: string): void {
    TextGenerationService.userResponses = null;

    if (text === 'Create Procedure') {
      TextGenerationService.isprocedure = false;
      this.onCreateButtonPress();
    } else if (text === 'Edit Procedure') {
			this.textGenerationService.edit=true;
      TextGenerationService.isprocedure = true;
      this.onEditButtonPress();
    }
  }
	private async createProcedureFromJson(): Promise<void> {
    try {
      if (!this.secondLastMessage?.trim()) {
        throw new Error('No procedure data available');
      }

      // Debug the raw input
      console.log('Raw procedure data:', this.secondLastMessage);

      // Parse the JSON data with error handling
      let procedureData: any;
      try {
        procedureData = JSON.parse(this.secondLastMessage);
      } catch (e) {
        console.error('JSON parsing error:', e);
        throw new Error('Invalid JSON format for procedure data');
      }

      // Validate required fields
      if (!procedureData?.name) {
        throw new Error('Procedure name is required');
      }

      // Ensure procedureStepInputList exists and is properly formatted
      let procedureStepInputList: IProcedureStepInput[] = [];
      if (procedureData.procedureStepInputList) {
        if (!Array.isArray(procedureData.procedureStepInputList)) {
          throw new Error('Procedure steps must be provided as an array');
        }

        // Transform steps with proper error handling
        procedureStepInputList = procedureData.procedureStepInputList.map((step: any, index: number) => {
          if (!step || typeof step !== 'object') {
            throw new Error(`Step at position ${index + 1} is invalid`);
          }

          const stepName = step.name || step.title;
          if (!stepName) {
            throw new Error(`Step at position ${index + 1} must have a name or title`);
          }

          return {
            name: stepName,
            detail: step.detail || step.description || step.content || '',
            // Include other fields that might be required by the server
            stepType: step.stepType || 'NORMAL',
            orderIndex: step.orderIndex !== undefined ? step.orderIndex : index
          };
        });
      }

      // Prepare mutation variables with all required fields
      const mutationVariables: IProcedureCreate_RequestVariables = {
        accountId: this.accountId,
        manualId: this.manualId,
        procedureIndex: procedureData.procedureIndex || 0,
        name: procedureData.name,
        description: procedureData.description || '',
        detail: procedureData.detail || '',
        status: procedureData.status || 'DRAFT',
        isCopyProtected: Boolean(procedureData.isCopyProtected),
        keywordList: Array.isArray(procedureData.keywordList) ? procedureData.keywordList : [],
        sectorList: Array.isArray(procedureData.sectorList) ? procedureData.sectorList : [],
        functionList: Array.isArray(procedureData.functionList) ? procedureData.functionList : [],
        procedureStepInputList: procedureStepInputList
      };

      // Debug the final mutation variables
      console.log('Mutation variables:', mutationVariables);

      this.waitingForServer = true;
      const result = await lastValueFrom(
        this.procedureMutationsService.create(mutationVariables)
      );

      if (result?.data?.ProcedureCreate?._id) {
        this.navigateToProcedure(result.data.ProcedureCreate._id);
        this.resetChat();
      } else {
        throw new Error('Failed to create procedure: No ID returned from server');
      }
    } catch (error) {
      this.waitingForServer = false;
      console.error('Procedure creation failed:', error);
      this.messages.push({
        sender: 'bot',
        text: `Failed to create procedure: ${error instanceof Error ? error.message : 'Unknown error'}`
      });
    }
  }
  private navigateToProcedure(procedureId: string): void {
    this.viewRouter.navigate(
      [{
        outlets: {
          dialog: null,
          primary: [
            this.manualId,
            LibraryRoutingPaths.Procedures,
            procedureId,
            LibraryRoutingPaths.Steps
          ],
        },
      }],
      { relativeTo: this.activeViewRoute.parent.parent }
    );
  }

  private resetChat(): void {
    this.editorForm.reset();
    this.generatedProcedure = '';
    this.secondLastMessage = '';
    this.chatInput = '';
    this.messages = [{
      sender: 'bot',
      text: "Procedure created successfully! How can I help you next?",
    }];
    this.isBotTyping = false;
    this.scrollToBottom();
  }
}
