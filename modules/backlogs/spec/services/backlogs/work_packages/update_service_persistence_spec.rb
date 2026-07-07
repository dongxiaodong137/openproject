# frozen_string_literal: true

#-- copyright
# OpenProject is an open source project management software.
# Copyright (C) the OpenProject GmbH
#
# This program is free software; you can redistribute it and/or
# modify it under the terms of the GNU General Public License version 3.
#
# OpenProject is a fork of ChiliProject, which is a fork of Redmine. The copyright follows:
# Copyright (C) 2006-2013 Jean-Philippe Lang
# Copyright (C) 2010-2013 the ChiliProject Team
#
# This program is free software; you can redistribute it and/or
# modify it under the terms of the GNU General Public License
# as published by the Free Software Foundation; either version 2
# of the License, or (at your option) any later version.
#
# This program is distributed in the hope that it will be useful,
# but WITHOUT ANY WARRANTY; without even the implied warranty of
# MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
# GNU General Public License for more details.
#
# You should have received a copy of the GNU General Public License
# along with this program; if not, write to the Free Software
# Foundation, Inc., 51 Franklin Street, Fifth Floor, Boston, MA  02110-1301, USA.
#
# See COPYRIGHT and LICENSE files for more details.
#++

require "spec_helper"

RSpec.describe Backlogs::WorkPackages::UpdateService, "persistence", type: :model do
  shared_let(:admin) { create(:admin) }
  shared_let(:status) { create(:status, is_default: true) }
  shared_let(:project) { create(:project) }
  shared_let(:sprint) { create(:sprint, project:) }
  shared_let(:other_sprint) { create(:sprint, project:) }

  let(:user) { admin }
  let!(:story) { create(:work_package, status:, sprint:, project:) }

  describe "atomicity of the two-phase move" do
    it "rolls back the list change when move_after fails", :aggregate_failures do
      # move_after runs after the list-change save, on story itself. Raise so
      # the whole move must roll back as one unit.
      allow(story).to receive(:move_after).and_raise(ActiveRecord::StatementInvalid, "boom")

      original_sprint_id = story.sprint_id
      original_position = story.position

      expect do
        described_class.new(user:, story:).call(list_type: "sprint", list_id: other_sprint.id, prev_id: "")
      end.to raise_error(ActiveRecord::StatementInvalid)

      story.reload
      expect(story.sprint_id).to eq(original_sprint_id)
      expect(story.position).to eq(original_position)
    end
  end
end
